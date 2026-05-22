# Feature 05 — Comments CRUD (+ optimistic locking)

**Plan:** [feature_plans/05-comments.md](../feature_plans/05-comments.md)
**Approved:** 2026-05-23
**Status:** Done. Build clean. 101/101 unit tests pass. 14 live probes match the README contract; hard delete verified at DB level.

## What this feature delivers

Comments module nested under tickets per the README contract, reusing the Phase 4 optimistic-locking plumbing (which was refactored into `src/common/` as part of this phase). Last core-domain feature before extended capabilities (audit log, dependencies, attachments, etc.).

## Endpoints

| Method | Path | Auth | Status | Headers | Notes |
|---|---|---|---|---|---|
| `GET` | `/tickets/:ticketId/comments` | Required | 200 / 404 | — | 404 if ticket missing/soft-deleted |
| `POST` | `/tickets/:ticketId/comments` | Required | 200 / 400 / 404 | **`ETag: "1"`** | `@HttpCode(200)`; 404 ticket / 400 author / 400 empty content |
| `PATCH` | `/tickets/:ticketId/comments/:commentId` | Required | 200 / 400 / 404 / **409** / **428** | Request `If-Match` + Response new `ETag` | Only `content` mutable; 404 on path mismatch |
| `DELETE` | `/tickets/:ticketId/comments/:commentId` | Required | 200 / 404 | — | **Hard delete** (per spec §3.5: only Projects/Tickets soft-delete) |

Response body shape (per README): `{ id, ticketId, authorId, content, mentionedUsers: [{...}] }`. **`mentionedUsers` is always `[]` in Phase 5** — Phase 11 (@Mentions) populates it via a join.

## Key Logic

- **Nested routes:** `@Controller('tickets/:ticketId/comments')`. Both `ticketId` and `commentId` parsed via `ParseIntPipe`.
- **Ticket existence is verified on every read/write:** `TicketsService.findOne(ticketId)` propagates `NotFoundException` → uniform 404. Phase 6 (audit log) will be able to record the failed access.
- **Path consistency check:** `findOneInTicket(ticketId, commentId)` queries with `{ id: commentId, ticketId }` — if a comment exists but under a different ticket, returns null → 404 `"Comment N not found in ticket M"`. Prevents accidentally updating/deleting a comment via the wrong parent URL.
- **Optimistic locking:** same flow as Tickets — `EtagInterceptor` (now in `src/common/`) sets `ETag` from entity `version` before serialization strips it; `parseIfMatch` parses `If-Match: "<n>"`; missing → 428, mismatch → 409.
- **Hard delete:** `repo.delete(id)` (not `softDelete`). Row is physically removed.
- **`mentionedUsers: []` placeholder:** the controller wraps each `Comment` response with `withMentionedUsers(c)` which assigns `mentionedUsers: []`. Phase 11 will replace this implementation with a real join.

## How Implemented

| File | Role |
|---|---|
| [src/common/interceptors/etag.interceptor.ts](../issueflow-typescript/src/common/interceptors/etag.interceptor.ts) | **MOVED** from `src/tickets/` |
| [src/common/helpers/if-match.ts](../issueflow-typescript/src/common/helpers/if-match.ts) | **MOVED** from `src/tickets/` |
| [src/comments/entities/comment.entity.ts](../issueflow-typescript/src/comments/entities/comment.entity.ts) | `id, ticketId, authorId, content, version @Exclude, timestamps @Exclude`. **No `@DeleteDateColumn`** |
| [src/comments/dto/create-comment.dto.ts](../issueflow-typescript/src/comments/dto/create-comment.dto.ts) | `authorId @IsInt @IsPositive`, `content` 1–5000 |
| [src/comments/dto/update-comment.dto.ts](../issueflow-typescript/src/comments/dto/update-comment.dto.ts) | Only `content` (required) |
| [src/comments/comments.service.ts](../issueflow-typescript/src/comments/comments.service.ts) | Ticket+author validation, path-consistency check, version+If-Match check, hard delete |
| [src/comments/comments.controller.ts](../issueflow-typescript/src/comments/comments.controller.ts) | Nested routes; wraps responses with `mentionedUsers: []` |
| [src/comments/comments.module.ts](../issueflow-typescript/src/comments/comments.module.ts) | Imports `TicketsModule` + `UsersModule`; exports `CommentsService` for Phase 11 |
| [src/tickets/tickets.controller.ts](../issueflow-typescript/src/tickets/tickets.controller.ts) | **Modified:** import paths for `EtagInterceptor` + `parseIfMatch` updated to `src/common/` |
| [src/app.module.ts](../issueflow-typescript/src/app.module.ts) | **Modified:** registered `CommentsModule` |

## Tests

| File | Coverage | # |
|---|---|---|
| [src/comments/comments.service.spec.ts](../issueflow-typescript/src/comments/comments.service.spec.ts) | create happy/ticket-404/author-400; findAllByTicket happy/404; findOneInTicket happy/path-mismatch; update 428/409/happy/404; remove happy/404 | 13 |
| [src/comments/dto/create-comment.dto.spec.ts](../issueflow-typescript/src/comments/dto/create-comment.dto.spec.ts) | Valid; missing authorId; non-positive authorId; empty content; content > 5000 | 5 |

`npm test` → **101/101 passing** (5 + 16 + 15 + 14 + 33 + 18).

## Live Verification (against Postgres on 5433)

14 probes — every behavior matched the plan. Key behaviors confirmed:

- `POST` → 200 + `ETag: "1"` + `mentionedUsers: []` in response body.
- `POST` to missing ticket → 404 (`"Ticket 9999 not found"`).
- `PATCH` ETag chain `1→2` across one update, content changed.
- `PATCH /tickets/9999/comments/1` (comment exists under ticket 1) → 404 `"Comment 1 not found in ticket 9999"` — path consistency enforced.
- `PATCH` with extra `authorId` field → 400 `"property authorId should not exist"`.
- `DELETE` → 200 + comments table empty in DB (hard delete, not soft).
- All routes without JWT → 401.

## Deviations / Notes

1. **`mentionedUsers: []` placeholder.** Phase 11 populates.
2. **No audit-log entry yet.** Phase 6 backfills.
3. **Hard delete of comments** — per spec §3.5 (only Projects/Tickets soft-delete). A deleted comment is gone; no restore.
4. **Author validation on create only** — if a user is hard-deleted later, their `authorId` becomes a dangling reference. Acceptable per scope; will be noted in `run.md`.
5. **Comments allowed on DONE tickets** — spec doesn't restrict; reasonable interpretation.

## Cross-cutting Hooks Available for Later Phases

- `CommentsService` exported by `CommentsModule` — Phase 11 (@Mentions) will use `findOneInTicket` + add a join with `comment_mentions` to populate `mentionedUsers` in responses.
- `EtagInterceptor` + `parseIfMatch` now live in `src/common/` and are reusable by any future feature needing optimistic locking.
- `Comment` entity is the FK target for `CommentMention.commentId` (Phase 11).
- The `withMentionedUsers(comment)` controller helper is the integration point Phase 11 will replace.
