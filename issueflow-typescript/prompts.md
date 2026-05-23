# IssueFlow — AI & Agents Usage Notes

Per assignment section 4.5, this document summarizes the main and relevant AI prompts used during development. The workflow was AI-assisted but still engineering-led: features were planned, implemented, reviewed, tested, manually validated, and documented incrementally.

API behavior and endpoint contracts were checked against the provided `README.md` assignment specification throughout the project.

## Models And Tools Used

- **Claude / Claude Code**: primary planning and implementation assistant during the original feature build.
- **GPT-5 / ChatGPT**: used for review, requirement matching, bug analysis, and documentation polishing.
- **Codex**: used for repository inspection, code edits, test execution, and final QA improvements.
- **Postman AI assistance**: used to organize manual API validation strategies, generate request ideas, and reason about API test coverage.

## Accountability Statement

All AI-generated code, tests, documentation, and implementation plans were manually reviewed and understood before submission. AI output was treated as engineering assistance, not as an automatic replacement for design decisions. Final behavior was validated through automated tests and manual API checks before being accepted.

## Workflow Overview

The project followed a strict per-feature workflow:

1. **Plan** — write `feature_plans/<NN>-<name>.md` with scope, decisions, API contract, tests, acceptance criteria, and risks.
2. **Approve** — review the plan and lock interpretation points.
3. **Implement** — write code and focused tests.
4. **Live verify** — run the API against a real database and check behavior manually.
5. **Summarize** — write `features_summary/<NN>-<name>.md` after the feature was approved.
6. Repeat for the next feature.

Original workflow-setting prompt:

> "Let's do this: we're going to implement every feature one by one. Never implement two features at the same time. Also, create an implementation plan before each feature and save it in the feature implementation folder. Create unit tests to test each feature only. When I tell you to go to the next one, and after I approve it, add to the features_summary table the entire logic behind it and how we implemented it."

This prompt defined the development cadence. One feature was handled at a time, and each feature moved through planning, implementation, validation, and summary before continuing.

## Repository Artifacts

- `feature_plans/`: detailed per-feature plans.
- `features_summary/`: implementation summaries and decisions.
- `IMPLEMENTATION_PLAN.md`: top-level implementation plan.
- `AGENTS.md` and `CLAUDE.md`: AI-agent repository guidance.
- `TESTING.md` and `run.md`: manual validation, setup, and test instructions.

## Phase 0 — Foundation And Planning

**Goal:** Establish implementation order, architecture constraints, testing approach, and AI workflow before coding.

**Original prompt preserved:**

> "Let's create a robust implementation plan. Then we will create a separate implementation plan per feature. Also, for the entire project, if you think there is a need for skills, hooks, or custom slash commands, tell me. Create the robust implementation plan first."

**Representative prompts used:**

> "Read the assignment README carefully and turn it into an implementation plan with phases, dependencies, API contracts, and testing expectations."

> "Identify which requirements must be implemented literally and where the assignment leaves design decisions open."

> "Tell me if custom skills, hooks, or slash commands are needed, but prefer simple built-in tooling if it is enough."

**Validation/testing performed:** Confirmed the NestJS, TypeScript, TypeORM, and PostgreSQL stack; created the phase-based plan; decided that built-in tooling was enough.

## Phase 1 — Users & Authentication

**Goal:** Implement users, password hashing, JWT login, logout behavior, `/auth/me`, and authorization foundations.

**Representative prompts used:**

> "Implement the Users API exactly as described in README.md, including `POST /users/update/:userId` instead of normalizing it to a different REST shape."

> "Add JWT authentication with login returning `accessToken`, `tokenType`, and `expiresIn`, and make sure protected endpoints use the current authenticated user."

> "Add password support in a way that allows `/auth/login` to work, but document this as an extension to the user creation body."

> "If a user is deleted after login, should the token still work? Which behavior best fits the assignment requirements?"

**Validation/testing performed:** Tested user creation, duplicate handling, password hashing, login failures, logout revocation, protected routes, and deleted-user token rejection.

## Phase 2 — Projects

**Goal:** Implement project CRUD, owner validation, project soft delete, restore, and authorization rules.

**Representative prompts used:**

> "Implement Projects APIs according to README.md, including `GET /projects`, `GET /projects/:projectId`, `POST /projects`, `PATCH /projects/:projectId`, and `DELETE /projects/:projectId`."

> "Validate that project `ownerId` refers to an existing user and return a useful error if it does not."

> "Soft delete projects instead of hard deleting them, and expose admin-only restore/list-deleted routes."

**Validation/testing performed:** Tested project lifecycle, owner validation, hidden soft-deleted projects, admin-only deleted list, and restore behavior.

## Phase 3 — Tickets

**Goal:** Implement ticket CRUD, status lifecycle rules, priorities, types, assignment, due dates, and soft delete.

**Representative prompts used:**

> "Implement the Tickets API exactly from README.md, including query parameter `projectId` for list/export routes."

> "Validate DTOs for ticket status, priority, type, projectId, assigneeId, and dueDate using class-validator."

> "Enforce status lifecycle rules and reject updates to DONE tickets."

> "Make sure route order prevents `/tickets/export` and `/tickets/import` from being captured by `/:ticketId`."

**Validation/testing performed:** Tested creation, validation, status transitions, DONE lock behavior, soft delete, route order, and ticket filtering.

## Phase 4 — Optimistic Locking

**Goal:** Add consistent optimistic locking with TypeORM version columns, numeric ETags, `If-Match`, `428` missing precondition, and `409` stale version handling.

**Original architecture decision preserved:**

> **Optimistic locking (locked early):** "best practice" → ETag/If-Match with `@VersionColumn`, 428 missing / 409 mismatch.

**Representative prompts used:**

> "What is the best practice for preventing lost updates in this API? Should we use version fields, ETags, or timestamps?"

> "Implement optimistic locking with `ETag` and `If-Match`, where updates require a quoted integer like `"1"`."

> "Keep `428 Precondition Required` when `If-Match` is missing and `409 Conflict` when the supplied version is stale."

> "Test concurrency/conflict handling by fetching a resource, updating it once, then trying to update again with the old ETag."

**Validation/testing performed:** Tested valid ETags, missing `If-Match`, stale versions, ticket update conflicts, and comment update conflicts.

## Phase 5 — Comments & Mentions

**Goal:** Implement comments on tickets, comment updates/deletes, mention parsing, mention persistence, and mention lookup by user.

**Representative prompts used:**

> "Implement comments under `/tickets/:ticketId/comments` exactly as specified, including author validation and mentionedUsers in responses."

> "Parse `@username` mentions in comment content, validate existing users, persist mention relationships, and return mentioned user summaries."

> "Add `GET /users/:userId/mentions` with pagination and include the mentionedUsers array in each comment response."

> "Review the comment optimistic locking flow and make sure clients can update comments after retrieving them from the API."

**Validation/testing performed:** Tested mention extraction, mention lookup, comment update/delete, numeric comment versions, and `If-Match` update flow.

## Phase 6 — Dependencies

**Goal:** Implement ticket blocker relationships, dependency listing/removal, validation, cycle prevention, and DONE blocking rules.

**Representative prompts used:**

> "Implement ticket dependencies exactly as described: add a blocker, list blockers, and remove a blocker."

> "Reject self-dependencies and dependencies across different projects."

> "Add cycle detection so dependency chains cannot create loops."

> "When transitioning a ticket to DONE, reject the update if it has unresolved blocker tickets."

**Validation/testing performed:** Tested add/list/remove dependency flows, self-dependency rejection, cross-project rejection, cycle detection, and blocked DONE transitions.

## Phase 7 — CSV Import/Export

**Goal:** Implement bulk ticket export/import using CSV while preserving validation and partial-failure reporting.

**Representative prompts used:**

> "Implement `GET /tickets/export?projectId=...` returning CSV with the README fields."

> "Implement `POST /tickets/import` as multipart form-data with `file` and `projectId` fields."

> "Validate each imported CSV row through the same DTO rules as normal ticket creation."

> "Return `{ created, failed, errors }` and do not let one bad row fail the entire import."

**Validation/testing performed:** Tested CSV headers, export content, multipart upload, mixed valid/invalid rows, and import summary results.

## Phase 8 — Audit Logs

**Goal:** Record state-changing actions and expose read-only audit log retrieval with single-field filtering.

**Original strictness prompt preserved:**

> "follow the assignment requirements exactly for everything"

This drove the decision that `GET /audit-logs` supports all logs or one specific field filter at a time, because the assignment says logs can be "filtered by a specific field".

**Representative prompts used:**

> "Add audit logging for create, update, delete, restore, login, auto-assignment, and auto-escalation actions."

> "Create a consistent `AuditContext` so controllers pass the authenticated user into service methods."

> "For `GET /audit-logs`, allow either all logs or one filter: entityType, entityId, action, or actor."

> "Reject multiple audit filters with 400 because the requirement says filtered by a specific field."

**Validation/testing performed:** Tested audit log creation, audit query validation, single-field filtering, multiple-filter rejection, and audit entries after state changes.

## Phase 9 — Workload & Auto Assignment

**Goal:** Automatically assign unassigned tickets to the least-loaded developer and expose workload counts per project.

**Original architecture decisions preserved:**

> **Project membership:** revised from an explicit `project_members` table to derived membership from `owner_id ∪ DISTINCT tickets.assignee_id`, because the README defines no project-membership API.

> **Auto-escalation trigger:** user challenged the cron-based design — "why a cron job and not just rescale for every new ticket?" The final decision kept the time-based approach because overdue unresolved tickets must change even if no user touches them.

**Representative prompts used:**

> "Implement auto-assignment when a ticket is created without an assignee."

> "Pick the least-loaded DEVELOPER in the project and make tie-breaking deterministic."

> "Implement `/projects/:projectId/workload` with open ticket counts per project user."

> "Do not rebalance existing tickets when a ticket moves to DONE unless the README requires it."

**Validation/testing performed:** Tested derived membership, least-loaded assignment, deterministic tie-breaking, workload counts, and exclusion of DONE tickets.

## Phase 10 — Testing & Validation

**Goal:** Strengthen automated and manual validation so final behavior is checked across full API workflows.

**Representative prompts used:**

> "Run tests for every feature implemented in this project."

> "Make all the tests we need to make sure everything works."

> "Add full end-to-end integration tests that validate auth, optimistic locking, CSV, dependencies, attachments, audit logs, mentions, workload, restore flows, and authorization rules."

> "Check if everything in this project matches the requirements in the PDF/README."

**Validation/testing performed:** Ran build checks, unit tests, end-to-end tests, coverage runs, and Postman-based manual API validation.

## Phase 11 — Documentation & Finalization

**Goal:** Finalize setup instructions, testing documentation, AI usage notes, and submission polish.

**Representative prompts used:**

> "Document exact setup, build, run, and test steps in `run.md`."

> "Make sure `run.md` says the database runs in Docker using the provided compose.yml and PostgreSQL is exposed on localhost:5433."

> "Mention that API behavior and endpoint contracts follow the provided README.md assignment specification."

> "Add `npm run test:e2e` to run.md and describe what the e2e suite validates."

**Validation/testing performed:** Reviewed documentation against the README contract, confirmed setup/test commands were listed, and updated final AI usage notes.

## Dedicated Postman-Based Manual QA Workflow

Postman was used heavily as a manual validation tool in addition to automated tests. AI assistance helped plan request order, identify edge cases, and turn assignment requirements into practical API checks.

**Manual workflow:**

1. Register users with different roles and store JWT tokens.
2. Create projects, tickets, comments, dependencies, attachments, and CSV imports.
3. Exercise happy paths, invalid DTOs, missing auth, and role restrictions.
4. Validate audit logs after state-changing actions.
5. Reuse old `If-Match` values to verify optimistic-lock conflicts.

**Representative Postman/AI prompts used:**

> "Design a Postman collection order for this API so each request creates the data needed by the next request."

> "Generate negative API test cases for DTO validation: missing title, bad enum values, non-integer IDs, invalid email, invalid role, malformed dueDate."

> "How should I test JWT authorization in Postman for missing token, invalid token, deleted user token, and role-restricted admin endpoints?"

> "Create a Postman strategy to test optimistic locking: GET a resource, save ETag, PATCH successfully, then PATCH again with the old ETag and expect 409."

**Manual QA coverage:** JWT login/logout, deleted-user tokens, DTO validation, authorization, ETag conflicts, dependencies, CSV import/export, attachments, mentions, audit logs, workload, auto-assignment, and restore flows.

## Key Decisions And Issues Found

**Specification strictness:** The agents helped keep endpoints and behavior aligned with the README, including `POST /users/update/:userId`, soft delete only for Projects and Tickets, `200 OK` create responses where specified, and single-field audit-log filtering.

**Bugs caught by live verification:** Manual API runs caught issues around PostgreSQL date handling, TypeORM mention joins, literal route ordering for `/tickets/export`, and comment optimistic locking versions.

**Conventions enforced:** State-changing service methods accept audit context, controllers pass authenticated users into services, DTOs validate numeric and enum inputs explicitly, and tests cover both business logic and end-to-end API behavior.
