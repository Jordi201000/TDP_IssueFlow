# Phase 11 — @Mentions in Comments

> Closes the long-standing `mentionedUsers: []` placeholder from Phase 5. Parses `@username` tokens from comment bodies, persists the associations, and adds the `GET /users/:userId/mentions` lookup endpoint with pagination. Case-insensitive matching per spec §3.6.

## Goal

Real `mentionedUsers: [{ id, username, fullName }]` populated in every Comment response (single + list). New `MentionsModule` owns parsing + persistence + retrieval, so `CommentsModule` stays focused on comment CRUD. Comment create + update flow through `MentionsService` to (re-)evaluate the mention list against the new body.

## Scope (in)

1. `CommentMention` entity — composite PK `(comment_id, mentioned_user_id)`.
2. `MentionsModule`:
   - `MentionsService` — parse, persist, retrieve, paginate.
   - `MentionsController` — `GET /users/:userId/mentions`.
3. Helper `extractMentions(content: string): string[]` — pure function, returns lowercase usernames in order of first appearance, deduped.
4. **Wire into `CommentsService`:**
   - `create()` — after `repo.save(comment)`, call `mentions.persistFor(comment.id, content)`.
   - `update()` — after `repo.save(comment)`, call `mentions.persistFor(comment.id, content)` (which replaces the existing set).
5. **Replace `mentionedUsers: []` placeholder in `CommentsController`:**
   - `findAll` — batch `mentions.getMentionedUsersBatch(commentIds)` to avoid N+1.
   - `create` — single-shot `mentions.getMentionedUsersFor(commentId)`.
6. Pagination DTO: `{ page=1, pageSize=20 }`, `pageSize` capped at 100.
7. Unit tests: extractor edge cases, persistence (idempotent + replacement), pagination math, batch hydration.

## Scope (out — deferred)

- **Real-time notifications** to the mentioned users (no transport defined; spec uses the word "notified" loosely — the persisted association *is* the notification mechanism).
- **Auditing per-mention add/remove** — would 10x audit volume on chatty comments. Comment-level CREATE/UPDATE audit emits already exist; mentions are derived state from the comment body.
- **Markdown rendering** of `@mentions` — purely a backend store.
- **Self-mention restriction** — spec doesn't forbid it; a user can `@` themselves.

## API Contract (per README, literal)

| Method | Path | Query | Response | Notes |
|---|---|---|---|---|
| `GET` | `/users/:userId/mentions` | Optional: `page` (default 1), `pageSize` (default 20, max 100) | `200 { data: Comment[], total: number, page: number }` | Each `Comment` includes `mentionedUsers: [...]`. 404 if user missing. Auth required, no `@Roles`. |

Plus the existing Comment endpoints now return **real** `mentionedUsers`:
- `GET /tickets/:ticketId/comments` → list with hydrated mentions per comment
- `POST /tickets/:ticketId/comments` → 200 with hydrated mentions
- `PATCH /tickets/:ticketId/comments/:commentId` → 200 (still empty body per README); mentions re-evaluated server-side

## Entity

```ts
@Entity('comment_mentions')
export class CommentMention {
  @PrimaryColumn({ name: 'comment_id' }) commentId: number;
  @PrimaryColumn({ name: 'mentioned_user_id' }) mentionedUserId: number;
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
}
```

No FKs (consistent with project model). Validation at write time.

## Helper

```ts
// src/mentions/extract-mentions.ts
const MENTION_RE = /(?<![\w@])@([a-zA-Z0-9_-]{3,32})/g;

export function extractMentions(content: string): string[] {
  const seen = new Set<string>();
  for (const m of content.matchAll(MENTION_RE)) {
    seen.add(m[1].toLowerCase());
  }
  return [...seen];
}
```

Regex notes:
- `(?<![\w@])` — negative lookbehind: not preceded by word char or another `@` (so `bob@email.com` doesn't match `@email`).
- `[a-zA-Z0-9_-]{3,32}` — same charset + length as `CreateUserDto.username`.
- Lowercased before dedup so `@Jdoe` + `@jdoe` count once.

## Service Behaviors

| Method | Behavior |
|---|---|
| `persistFor(commentId, content)` | `extractMentions(content)`. For each name, case-insensitive user lookup (`LOWER(username) = LOWER(:name)`). Build the new `Set<userId>`. Compare with existing rows; insert new, delete removed. Unknown usernames silently skipped (spec says nothing about unknowns; a `@typo` shouldn't 500 the comment). |
| `getMentionedUsersFor(commentId)` | Returns `[{ id, username, fullName }]` for one comment via a single JOIN-like query. |
| `getMentionedUsersBatch(commentIds[])` | Returns `Record<commentId, MentionedUser[]>`. One IN-query for `comment_mentions`, one IN-query for `users`, then assemble in memory. |
| `findCommentsForUser(userId, page, pageSize)` | 1) Validate user exists → 404. 2) Count + select comment ids where `mentioned_user_id = userId`, newest first by `created_at DESC`, paginated. 3) Hydrate comments + their mentions. 4) Return `{ data, total, page }`. |

**Case-insensitivity:** SQL `LOWER()` works portably across PG + SQLite (verified earlier with TypeORM). Used in both lookup-by-name (persistFor) and any direct username comparisons.

## File Layout

```
src/mentions/
├── mentions.module.ts
├── mentions.controller.ts
├── mentions.service.ts
├── mentions.service.spec.ts
├── extract-mentions.ts
├── extract-mentions.spec.ts
├── dto/
│   └── mentions-query.dto.ts          # page + pageSize validation
└── entities/
    └── comment-mention.entity.ts
```

Modified:
- [src/comments/comments.service.ts](../issueflow-typescript/src/comments/comments.service.ts) — inject `MentionsService`; call `persistFor` after `create`/`update`.
- [src/comments/comments.controller.ts](../issueflow-typescript/src/comments/comments.controller.ts) — replace `withMentionedUsers` placeholder with real lookup; batch for list.
- [src/comments/comments.module.ts](../issueflow-typescript/src/comments/comments.module.ts) — import `MentionsModule`.
- [src/comments/comments.service.spec.ts](../issueflow-typescript/src/comments/comments.service.spec.ts) — add `MentionsService` mock to providers.
- [src/app.module.ts](../issueflow-typescript/src/app.module.ts) — register `MentionsModule`.

`MentionsModule` does NOT import `CommentsModule` — it gets direct `Repository<Comment>` access via `TypeOrmModule.forFeature([CommentMention, Comment])` to avoid a circular dependency. Same pattern used in Phase 7 for `TicketDependency`.

## DTO (pagination)

```ts
// src/mentions/dto/mentions-query.dto.ts
export class MentionsQueryDto {
  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt() @Min(1)
  page?: number = 1;

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt() @Min(1) @Max(100)
  pageSize?: number = 20;
}
```

`@Transform` over `@Type` per Phase 6 learning (test-isolation friendlier).

## Unit Tests (Phase 11)

`extract-mentions.spec.ts`:
1. Simple `@jdoe` → `['jdoe']`.
2. Multiple distinct → preserves order, deduped.
3. Case-insensitive dedup: `@JDoe @jdoe` → `['jdoe']`.
4. Skips email-looking strings: `bob@example.com` → `[]`.
5. Min/max length boundaries (≥3, ≤32).
6. Empty string + no-mentions input → `[]`.
7. Mention at start of string still parses.

`mentions.service.spec.ts`:
8. `persistFor` inserts new mentions; calls user lookup case-insensitively.
9. `persistFor` skips unknown usernames silently.
10. `persistFor` replaces: removes mentions not in new content; adds new ones.
11. `getMentionedUsersFor` returns hydrated `[{id, username, fullName}]`.
12. `getMentionedUsersBatch` returns `Record<commentId, MentionedUser[]>`.
13. `findCommentsForUser` validates user exists (→ 404).
14. `findCommentsForUser` paginates (page=2, pageSize=2 → returns rows 3-4).
15. `findCommentsForUser` returns `{ data, total, page }` shape.

`mentions-query.dto.spec.ts`:
16. Defaults page=1, pageSize=20.
17. Coerces strings to numbers.
18. Rejects pageSize > 100.

`comments.service.spec.ts` (small additions):
19. `create` calls `mentions.persistFor(savedId, content)` after save.
20. `update` calls `mentions.persistFor(commentId, newContent)` after save.

Total new: **~20 tests.** Running total post-Phase 11: **~193.**

## Acceptance Criteria

- [ ] Build clean. All 173 prior tests pass; ~20 new pass.
- [ ] Live probes:
  - Register `alice` + `bob`. Create a ticket as alice.
  - `POST /tickets/:tid/comments` `{authorId: alice, content: "Hey @bob and @Bob, take a look"}` → 200 with `mentionedUsers: [{id: bob.id, username: "bob", fullName: "Bob"}]` (deduped, case-insensitive).
  - `POST` with `@nonexistent` mention → 200 (silently skipped), `mentionedUsers: []`.
  - `GET /tickets/:tid/comments` → list shows hydrated mentions.
  - `GET /users/<bob.id>/mentions` → 200 with `{ data: [...], total: 1, page: 1 }` containing the comment.
  - `GET /users/<bob.id>/mentions?page=1&pageSize=100` → 200; `pageSize=101` → 400.
  - `PATCH` the comment to `{content: "no mentions now"}` → 200; subsequent `GET /users/<bob.id>/mentions` → `total: 0`.
  - `PATCH` to `{content: "@alice now"}` → subsequent `GET /users/<alice.id>/mentions` → `total: 1`; `GET /users/<bob.id>/mentions` → `total: 0`.
  - `GET /users/9999/mentions` → 404.
  - Email-like string `"contact bob@example.com"` → no mentions persisted.
  - DB check: `select * from comment_mentions` shows the expected (commentId, userId) pairs.

## Risks / Notes

- **N+1 risk on comment lists** mitigated by `getMentionedUsersBatch` (one IN-query per batch). Live verify includes a multi-comment list to catch obvious regressions.
- **Unknown-username silent skip** is the most defensible interpretation. The alternative — reject the entire comment — would surprise users (typos can't post). Spec is silent; documented.
- **No audit per-mention.** Comment-level UPDATE audit covers the broader change; per-mention rows would balloon the audit table.
- **Case-insensitive lookup uses `LOWER()`** in raw SQL via TypeORM query builder. Portable PG + SQLite.
- **Username regex** matches `CreateUserDto`'s charset + length. If those constraints ever change, update the mention regex too.
- **Newest-first ordering** uses `comment.createdAt` — which is `@Exclude()`-d from the JSON response (since Phase 5). The field still exists on the entity; ordering by it works fine. Just hidden from clients.
