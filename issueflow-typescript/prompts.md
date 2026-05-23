# IssueFlow — AI Usage Notes

Per assignment §4.5: model used, workflow, representative prompts, and artifacts.

## Model

**Claude Opus 4.7** (`claude-opus-4-7`) for the entire build.

## Workflow

Strict per-feature cadence enforced via a workflow memory the user established up front:

1. **Plan** — agent writes `feature_plans/<NN>-<name>.md` (detailed: scope, decisions, API contract, file layout, tests, acceptance criteria, risks)
2. **Approve** — user reviews the plan, locks in interpretation points
3. **Implement** — agent writes code + unit tests
4. **Live verify** — agent runs against real Postgres, exercises each acceptance criterion
5. **Approve again** — user says "go to next one"
6. **Summary** — agent writes `features_summary/<NN>-<name>.md` (retrospective: what was built, key logic, file map, tests, live probes, deviations, cross-cutting hooks)
7. Repeat for the next feature

One feature at a time. No bundling. No code before plan approval. No summary before code approval. **221 unit tests + 14 live-verified phases** under this cadence.

## Repository artifacts

- `feature_plans/` (one level up): 14 detailed plans, one per phase
- `features_summary/` (one level up): 13 retrospectives (Phase 14 is this doc itself)
- `IMPLEMENTATION_PLAN.md` (one level up): top-level plan with locked decisions table
- `AGENTS.md` (this dir): cross-vendor repo guide
- `CLAUDE.md` (this dir): Claude-specific orientation
- `TESTING.md` (this dir): manual smoke-test runbook
- `run.md` (this dir): install/build/run/test guide
- `.claude/projects/.../memory/` (user's home, not in repo): persistent memory across sessions — project context, per-feature workflow, locked decisions

## Representative prompts

The most load-bearing exchanges that shaped the build.

### Foundation (Phase 0)

> "lets create a rebust implemntation plan, the we will create sperate implemntation plan per feature, also for the entire project if you think there is a need in skills/hooks/ custom slash commands tell me. create the rebust implemntation plan first"

Locked the 14-phase order + tooling philosophy. The "tell me if you think we need custom skills" prompt established the design constraint that we'd prefer built-in tools over custom infrastructure (and we never needed any).

### Per-feature cadence (set the workflow that ran every phase)

> "lets do this: were going to implement every feature on by one never implement two features, also, you create implementation plan before each feature and save it in feature implementation folder, also create unit tests to test each feature only when i tell you go to next one, also after i approve you add to features_summary table the entire logic behind it and how we implemented it"

This single message defined the per-feature workflow that ran 14 times. Stored as a `feedback` memory so it persists across sessions.

### Architecture trade-offs

> **Optimistic locking (locked early):** "best practice" → ETag/If-Match with `@VersionColumn`, 428 missing / 409 mismatch.

> **Project membership (revised after discussion):** initial decision was "explicit `project_members` table"; revised to "derived from `owner_id ∪ DISTINCT tickets.assignee_id`" after the user asked the agent to validate against spec literally. The derived approach is equally compliant since the spec defines no API to manage membership.

> **Auto-escalation trigger:** user challenged the cron-based design — "why a cron job and not just rescale for every new ticket?" Agent explained: spec wording ("auto-scheduling", "remain unresolved past a configured due date") implies time-based; on-read mutation would break HTTP idempotency; untouched tickets never escalate without a periodic process. User picked cron.

### Strictness on the spec

Recurring user direction:

> "follow the assignment requirements exactly for everything"

Resulted in:
- README literal endpoints (`POST /users/update/:userId`, not REST-normalized `PATCH /users/:id`)
- Soft delete only on Projects + Tickets (per §3.5); everything else hard delete
- 200 OK responses (not Nest's default 201) for all create endpoints to match README
- Single-field filter on `GET /audit-logs` (multiple → 400)
- No HTTP endpoint for download/list on Attachments — README only declares POST/DELETE
- No re-balance on DONE for auto-assignment — only on create, per §3.8

### Catching bugs in live verification

The plan→implement→**live verify** cadence caught real issues that mocked unit tests passed through:

- **Phase 4:** `type: 'datetime'` on `dueDate` doesn't exist in Postgres (MySQL/SQLite only). Caught at app boot. Fixed → `type: 'timestamp'`.
- **Phase 11:** Query builder joined `comment_mentions` by table-name string; TypeORM 0.3 needs entity-class joins. Caught when `GET /users/:id/mentions` 500'd. Fixed → `.innerJoin(CommentMention, 'cm', ...)`.
- **Phase 9 (live):** Route collision risk on `/tickets/export` vs `/tickets/:ticketId` — controlled by declaring literal routes first in the controller class. Verified live (the parametric GET still works after adding `export`).

## Skills, instructions, hooks

- **No custom slash commands or hooks** were used. Built-in Claude Code tooling sufficed (TodoWrite for in-feature task tracking, ToolSearch for loading deferred tools like TaskStop / Bash backgrounding).
- **Instruction files:** `AGENTS.md` (cross-vendor) + `CLAUDE.md` (Claude-specific) live in this directory.
- **Memory:** the agent maintained a small set of persistent memories under `.claude/projects/.../memory/` — `project-issueflow` (locked decisions), `feedback-workflow` (per-feature cadence). Re-read at session start so a fresh conversation picks up cleanly.

## Conventions the agent enforced consistently

Worth mentioning because they show up everywhere in the code:

- Optional `ctx?: AuditContext` on every state-changing service method. Existing tests don't pass ctx → audit is skipped. Controllers pass ctx via `@CurrentUser()`. SYSTEM audits (auto-escalate, auto-assign) fire unconditionally on ctx.
- Cross-feature reads via `Repository<X>` injection — never service-to-service imports — to avoid circular module dependencies. Used by Phases 7, 11, 12, 13.
- Literal route segments declared **before** parametric ones in controllers (`@Get('export')` before `@Get(':ticketId')`).
- DTOs use `@Transform(({value}) => Number(value))` instead of `@Type(() => Number)` — the latter broke test-isolation in Phase 6.
