# Feature 11 — @Mentions in Comments

**Plan:** [feature_plans/11-mentions.md](../feature_plans/11-mentions.md)
**Approved:** 2026-05-23
**Status:** Done. Build clean. 196/196 unit tests pass. 11 live probes pass after one runtime bug caught + fixed.

## What this feature delivers

Replaces the `mentionedUsers: []` placeholder from Phase 5 with real persistence and retrieval. Parses `@username` tokens from comment bodies (case-insensitive, charset/length match `CreateUserDto.username`), persists associations in `comment_mentions`, and exposes `GET /users/:userId/mentions` with pagination. Comment create + update flow through `MentionsService` to (re-)evaluate the mention set against the new body.

## Endpoints

| Method | Path | Auth | Query | Response | Notes |
|---|---|---|---|---|---|
| `GET` | `/users/:userId/mentions` | Required | Optional `page` (default 1), `pageSize` (default 20, max 100) | `200 { data: Comment[], total: number, page: number }` | Each `data[i]` includes `mentionedUsers: [...]`. 404 if user missing. |

Plus the existing Comment endpoints now return **real** `mentionedUsers`:
- `GET /tickets/:ticketId/comments` — batch-hydrated to avoid N+1
- `POST /tickets/:ticketId/comments` — hydrated for the new row
- `PATCH /tickets/:ticketId/comments/:commentId` — re-evaluates server-side; response body still empty per README

## Key Logic

- **`extractMentions(content)`** — `(?<![\w@])@([a-zA-Z0-9_-]{3,32})/g` regex. Negative lookbehind blocks email-like strings (`bob@example.com` doesn't match `@example`). Lowercased + deduped, first-occurrence order.
- **`persistFor(commentId, content)`** — case-insensitive user lookup via `LOWER(u.username) IN (:...names)`. Reconciles the existing mention set with the new one: inserts new, deletes removed. **Unknown usernames silently skipped** per locked decision.
- **`getMentionedUsersBatch(commentIds[])`** — one IN-query for `comment_mentions`, one IN-query for `users`, assembled in memory. Used by `GET /tickets/:id/comments` to avoid N+1.
- **`findCommentsForUser(userId, page, pageSize)`** — query builder with `innerJoin(CommentMention, 'cm', 'cm.commentId = c.id')`, paginated, then batch-hydrated.
- **No per-mention audit emit** per locked decision; the existing `COMMENT CREATE/UPDATE` audit covers the broader change.

## How Implemented

| File | Role |
|---|---|
| [src/mentions/entities/comment-mention.entity.ts](../issueflow-typescript/src/mentions/entities/comment-mention.entity.ts) | Composite PK `(commentId, mentionedUserId)`, `createdAt` |
| [src/mentions/extract-mentions.ts](../issueflow-typescript/src/mentions/extract-mentions.ts) | Regex parser; case-insensitive dedup; first-occurrence order |
| [src/mentions/mentions.service.ts](../issueflow-typescript/src/mentions/mentions.service.ts) | persistFor (reconcile), getMentionedUsersBatch (N+1 fix), findCommentsForUser (paginated + hydrated) |
| [src/mentions/mentions.controller.ts](../issueflow-typescript/src/mentions/mentions.controller.ts) | `GET /users/:userId/mentions` |
| [src/mentions/dto/mentions-query.dto.ts](../issueflow-typescript/src/mentions/dto/mentions-query.dto.ts) | `page` ≥ 1, `pageSize` ≥ 1 ≤ 100; `@Transform(({value}) => Number(value))` for string coercion |
| [src/mentions/mentions.module.ts](../issueflow-typescript/src/mentions/mentions.module.ts) | Imports `[CommentMention, Comment, User]` — no `CommentsModule` import (avoids circular) |
| [src/comments/comments.service.ts](../issueflow-typescript/src/comments/comments.service.ts) | **Modified:** injects `MentionsService`; calls `persistFor` after create + update |
| [src/comments/comments.controller.ts](../issueflow-typescript/src/comments/comments.controller.ts) | **Modified:** `withMentionedUsers` placeholder replaced; batch hydrate for list, single for create |
| [src/comments/comments.module.ts](../issueflow-typescript/src/comments/comments.module.ts) | **Modified:** imports `MentionsModule` |
| [src/comments/comments.service.spec.ts](../issueflow-typescript/src/comments/comments.service.spec.ts) | **Modified:** mocks `MentionsService` in providers + 2 new tests |
| [src/app.module.ts](../issueflow-typescript/src/app.module.ts) | **Modified:** registers `MentionsModule` |

## Tests

| File | Coverage | # |
|---|---|---|
| [src/mentions/extract-mentions.spec.ts](../issueflow-typescript/src/mentions/extract-mentions.spec.ts) | Single + multiple, case-insensitive dedup, email skip, length boundaries, empty, start-of-string | 8 |
| [src/mentions/dto/mentions-query.dto.spec.ts](../issueflow-typescript/src/mentions/dto/mentions-query.dto.spec.ts) | Empty, string→int coercion, pageSize cap, page ≥ 1 | 4 |
| [src/mentions/mentions.service.spec.ts](../issueflow-typescript/src/mentions/mentions.service.spec.ts) | persistFor insert/skip/replace/no-op; getMentionedUsersBatch empty + hydrated; findCommentsForUser 404, shape, pagination offset | 9 |
| [src/comments/comments.service.spec.ts](../issueflow-typescript/src/comments/comments.service.spec.ts) (ext.) | create/update both call `mentions.persistFor` | 2 |

`npm test` → **196/196 passing** (5 + 16 + 15 + 14 + 33 + 18 + 16 + 15 + 20 + 13 + 8 + 23).

## Live Verification (against Postgres on 5433)

11 probes — all behaviors confirmed:

```
POST comment "@bob and @Bob, take a look"
  → mentionedUsers: [{id:16,username:"bob",fullName:"Bob"}]   (dedup case-insensitive)

POST comment "hello @nonexistent"
  → mentionedUsers: []                                          (silent skip)

POST comment "contact bob@example.com please"
  → mentionedUsers: []                                          (email lookbehind)

GET /tickets/1/comments
  → all 3 comments returned with hydrated mentions per comment  (batch hydrate, no N+1)

GET /users/16/mentions
  → { data: [...], total: 1, page: 1 }                          (after fix; see below)

GET /users/16/mentions?pageSize=101                              → 400
GET /users/9999/mentions                                         → 404

PATCH comment 1 to "now mentioning @alice only"
GET /users/16/mentions                                           → total: 0   (bob removed)
GET /users/15/mentions                                           → total: 1   (alice added)
GET /users/15/mentions?pageSize=1&page=1                         → paginated correctly

DB: select * from comment_mentions
  → comment_id=1 → mentioned_user_id=15                         (replace worked)

Audit count (entityType=COMMENT)
  → 3 CREATE + 1 UPDATE = 4 entries (no per-mention noise)
```

## Bug Caught + Fixed During Live Verify

**Problem:** First call to `GET /users/16/mentions` returned `500 "Cannot read properties of undefined (reading 'databaseName')"`. The query builder joined `comment_mentions` by **table-name string** (`.innerJoin('comment_mentions', 'cm', 'cm.comment_id = c.id')`). TypeORM 0.3 doesn't reliably resolve table-name joins; it expects an entity class so it can use the metadata.

**Fix:** `.innerJoin(CommentMention, 'cm', 'cm.commentId = c.id')` — joins by entity class. TypeORM autoresolves `commentId` → `comment_id` and `createdAt` → `created_at` from entity metadata. Same for the `WHERE`/`ORDER BY` clauses (use entity property names, not column names). All 196 unit tests still pass; live retry returned the correct paginated shape.

## Deviations / Notes

1. **Unknown `@username` mentions silently skipped** — per locked decision. A typo'd mention doesn't break the comment.
2. **No per-mention audit** — comment-level CREATE/UPDATE already captures the broader change. The `comment_mentions` table is itself the permanent record.
3. **Case-insensitive lookup via `LOWER()`** — portable across PG + SQLite. Username uniqueness in the DB is still case-sensitive (a Phase 1 carry-over); only mention matching is case-insensitive.
4. **`createdAt` is `@Exclude()`-d from JSON** but still exists on the entity for query ordering — verified by the newest-first behavior.

## Cross-cutting Hooks Available for Later Phases

- The "join-by-entity-class" pattern documented in code comments — Phase 12 (escalation) + Phase 13 (workload) will use the same shape for any TypeORM query-builder joins.
- `MentionsService.getMentionedUsersBatch` is a reusable batch-hydration template; the same shape would apply to any future relation that needs response-side hydration.
- `MentionsModule` is exported as a service; future features could call `persistFor` if they accept user-mentioning content (e.g., if ticket descriptions ever support `@mentions`).
