# Phase 14 — Quality & Docs (submission prep)

> Final phase. All 13 spec features are implemented and live-verified. This phase produces the artifacts the assignment explicitly requires (§4.4, §4.5) plus a smoke-test runbook so the grader can quickly confirm everything works.

## Goal

Ship-ready repo: spec-required docs (`run.md`, `prompts.md`), an AI instruction file (`CLAUDE.md`), a manual smoke-test playbook (`TESTING.md`), and cleanup of the orphan e2e file from the skeleton. Optional final quality passes via the `simplify` and `security-review` skills.

## Scope (in)

1. **`run.md`** in `issueflow-typescript/` — install, build, run, test, with the Phase 0 setup notes (Node 20.11+, host port 5433, `synchronize:true` dev-only, etc.).
2. **`prompts.md`** in `issueflow-typescript/` — AI usage doc per spec §4.5: model name (Claude Opus 4.7), main prompts, skills/instruction files used.
3. **`CLAUDE.md`** in `issueflow-typescript/` — instruction file codifying repo conventions for future AI sessions (also satisfies §4.5 "Add instruction files").
4. **`TESTING.md`** in `issueflow-typescript/` — manual smoke-test runbook. Curl commands grouped by feature; copy-paste-runnable; each section has an expected outcome.
5. **Delete the orphan skeleton e2e test** (`test/app.e2e-spec.ts`) — references the deleted `AppController`; flagged since Phase 1.
6. **Final test run** — confirm 221/221 still pass after cleanup.
7. **Final live boot** — sanity-check the app starts cleanly.

## Scope (out — optional)

- `/simplify` skill pass — could shrink some code, but risk introducing churn at the last moment.
- `/security-review` skill pass — would inspect dependencies + DTOs. Useful but not spec-required.
- A real Jest e2e suite (`test/*.e2e-spec.ts`) — would duplicate what `TESTING.md` already covers manually.

## File Deliverables

### `issueflow-typescript/run.md`

Sections:
1. **Prerequisites** — Node 20.11+, Docker, npm
2. **Install** — `nvm use 20 && npm install`
3. **Database** — `docker compose up -d`; note host port 5433 (collision avoidance)
4. **Configure** — copy `.env.example` to `.env` (or rely on defaults)
5. **Run** — `npm run start` / `npm run start:dev`
6. **Test** — `npm test` (Jest, in-memory SQLite for test DB)
7. **Boot verification** — `curl http://localhost:3000/health`
8. **Known constraints** — `synchronize:true` is dev-only; `/uploads` gitignored; JWT TTL configurable

### `issueflow-typescript/prompts.md`

Sections:
1. **Model used** — Claude Opus 4.7 throughout
2. **Workflow** — per-feature plan → approve → code+tests → live verify → summary
3. **Repo artifacts** — `feature_plans/`, `features_summary/`, `IMPLEMENTATION_PLAN.md`, `MEMORY.md` (in `.claude/`)
4. **Representative prompts** — 5-10 key prompts that drove the build (foundation choice, NestJS vs Java, optimistic-locking pattern, derived membership decision D5, etc.)
5. **Skills/decorators used** — built-in `TodoWrite`; no custom slash commands; standard NestJS decorators

### `issueflow-typescript/CLAUDE.md`

Sections:
1. **Stack** — NestJS 11, TypeORM, Postgres (runtime) / SQLite-in-memory (tests)
2. **Conventions**:
   - Soft delete: only Projects/Tickets (§3.5); everything else hard delete
   - Optimistic locking: ETag/If-Match on Tickets + Comments; 428 missing, 409 mismatch
   - Audit log: `auditService.record(...)` after each state change; optional `ctx?: AuditContext`; SYSTEM-actor emits unconditional
   - Route ordering: literal segments before parametric (`@Get('export')` before `@Get(':id')`)
   - Module isolation: cross-feature reads via `Repository<X>` injection, not service-to-service imports
   - DTOs use `@Transform(({value}) => Number(value))` over `@Type(() => Number)` (test-isolation friendly)
3. **Per-feature workflow** — plan/summary cadence

### `issueflow-typescript/TESTING.md`

(Detailed manual smoke-test playbook — see standalone file.)

## Implementation Order

1. Write `TESTING.md` first (user explicitly asked for it).
2. Write `CLAUDE.md`.
3. Write `prompts.md`.
4. Write `run.md`.
5. Delete `test/app.e2e-spec.ts` + the empty `test/` directory if it becomes empty.
6. Run `npm test` → confirm 221/221.
7. Live boot once → confirm health returns ok.
8. Final report.

## Acceptance Criteria

- [ ] `run.md` covers install through test on a fresh clone.
- [ ] `prompts.md` names the model and lists representative prompts.
- [ ] `CLAUDE.md` codifies the conventions a future AI session would need.
- [ ] `TESTING.md` is copy-paste-runnable from a fresh `docker compose up -d` + `npm start`.
- [ ] `test/app.e2e-spec.ts` removed; `npm test` still 221/221.
- [ ] `npm run build` clean.
- [ ] App boots cleanly; `/health` returns 200.

## Risks / Notes

- **`TESTING.md` is the highest-value artifact for grading.** A grader who follows it gets a guided tour of every feature in ~10 minutes.
- **No new code in this phase** — only docs + one deletion.
- **Optional `simplify` pass is tempting but risky** at submission time. Skipping unless something obvious surfaces while writing docs.
