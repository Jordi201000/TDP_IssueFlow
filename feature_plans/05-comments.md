# Phase 5 — Comments CRUD (+ optimistic locking)

> Last core-domain feature before extended capabilities (audit log, dependencies, attachments, etc.). Structurally simpler than Tickets: smaller entity, no soft delete (per spec §3.5 only Projects/Tickets soft-delete; everything else is real-delete per your locked direction), no lifecycle, but **does need optimistic locking** per spec §2.5 ("Two users can't edit a comment at the same time"). Mentions parsing (§3.6) is Phase 11.

## Goal

A `Comments` module nested under tickets per the README contract — paths shaped as `/tickets/:ticketId/comments/...`. Reuses the ETag/If-Match plumbing from Phase 4 (moved to `src/common/` since it now serves two features). Comments are hard-deleted per the assignment rule "soft delete only for Projects and Tickets, real delete for the rest".

## Scope (in)

1. **Refactor Phase 4 plumbing into `src/common/`:**
   - Move `EtagInterceptor` from `src/tickets/interceptors/` → `src/common/interceptors/`.
   - Move `parseIfMatch` helper from `src/tickets/helpers/` → `src/common/helpers/`.
   - Update Tickets imports to the new location. (No behavior change; all Phase 4 tests must still pass.)
2. `Comment` entity with `@VersionColumn`, `content`, `ticketId`, `authorId`, `createdAt`. **No `@DeleteDateColumn`** (hard delete).
3. DTOs (`CreateCommentDto`, `UpdateCommentDto`).
4. Service:
   - `create(ticketId, dto)` — verify ticket exists (→ 404 if missing/soft-deleted); verify author exists (→ 400); persist; return entity.
   - `findAllByTicket(ticketId)` — list all comments for ticket; verify ticket exists (→ 404 if missing).
   - `update(ticketId, commentId, dto, expectedVersion)` — DONE-lock-free; uses same If-Match flow as Tickets: missing → 428, mismatch → 409. Verifies the comment belongs to the given `ticketId` (→ 404 if path mismatch). Mutates only `content`.
   - `remove(ticketId, commentId)` — hard delete; verifies the comment belongs to the ticket (→ 404).
5. Controller per README:
   - `GET /tickets/:ticketId/comments`
   - `POST /tickets/:ticketId/comments` body `{ authorId, content }`
   - `PATCH /tickets/:ticketId/comments/:commentId` body `{ content }`
   - `DELETE /tickets/:ticketId/comments/:commentId`
6. Reuse `EtagInterceptor` at the Comments controller scope (post-refactor); manually set new `ETag` on PATCH response.
7. All endpoints **auth-required** (global guard from Phase 2). No `@Public()`.
8. Unit tests for service + DTO validation.

## Scope (out — deferred)

- **@username parsing + mentions persistence** — Phase 11 (§3.6). For Phase 5, `content` is just an opaque string.
- **Audit-log emission** — Phase 6 backfills.
- **Real-world "edit lock" UI/policy beyond optimistic locking** — out of assignment scope.

## API Contract (per README, literal)

| Method | Path | Body | Response | Notes |
|---|---|---|---|---|
| `GET` | `/tickets/:ticketId/comments` | — | `200 [{...}]` | 404 if ticket missing/soft-deleted |
| `POST` | `/tickets/:ticketId/comments` | `{ authorId, content }` | `200 {...}` | `@HttpCode(200)`; 404 if ticket missing; 400 if author missing |
| `PATCH` | `/tickets/:ticketId/comments/:commentId` | `{ content }` + `If-Match: "<n>"` | `200` (empty) + new `ETag` | 428/409 same as Tickets; 404 if comment not under that ticket |
| `DELETE` | `/tickets/:ticketId/comments/:commentId` | — | `200` (empty) | Hard delete; 404 if not found / not under ticket |

Response body shape (per README): `{ id, ticketId, authorId, content, mentionedUsers: [{ id, username, fullName }] }`. **For Phase 5, `mentionedUsers` is always `[]`** (Phase 11 populates it). DTOs/entity don't include `version` or `createdAt` in responses (`@Exclude()`).

## Entity

```ts
@Entity('comments')
export class Comment {
  @PrimaryGeneratedColumn() id: number;
  @Column({ name: 'ticket_id' }) ticketId: number;
  @Column({ name: 'author_id' }) authorId: number;
  @Column({ type: 'text' }) content: string;
  @VersionColumn() @Exclude() version: number;
  @CreateDateColumn({ name: 'created_at' }) @Exclude() createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at' }) @Exclude() updatedAt: Date;
  // Phase 11 will add: mentionedUsers virtual field populated by service via join.
}
```

For Phase 5, the controller will inject a constant `mentionedUsers: []` into responses so the body shape matches the README. Phase 11 will replace this with the real join.

## DTOs

```ts
// CreateCommentDto
@IsInt() @IsPositive() authorId: number;
@IsString() @IsNotEmpty() @MaxLength(5000) content: string;

// UpdateCommentDto
@IsString() @IsNotEmpty() @MaxLength(5000) content: string;
// (no IsOptional — content is required on update; only field permitted)
```

## Service Behaviors

| Method | Behavior |
|---|---|
| `create(ticketId, dto)` | Validate ticket via `TicketsService.findOne(ticketId)` (throws NotFound → propagated as 404). Validate author via `UsersService.findOne(authorId).catch(() => null)` → 400 if missing. Persist. Return entity. |
| `findAllByTicket(ticketId)` | Validate ticket exists (→ 404). Return `repo.find({ where: { ticketId } })`. |
| `findOneInTicket(ticketId, commentId)` | Helper. `repo.findOne({ where: { id: commentId, ticketId } })`. Throws `NotFoundException("Comment N not found in ticket M")` if either missing or path-mismatch. |
| `update(ticketId, commentId, dto, expectedVersion)` | 1) 428 if `expectedVersion` undefined. 2) Load via `findOneInTicket`. 3) 409 on version mismatch. 4) Apply `content`. 5) `repo.save` (bumps version). Return entity. |
| `remove(ticketId, commentId)` | Load via `findOneInTicket` (→ 404 if not found / not under ticket). `repo.delete(id)`. |

## File Layout

```
src/common/
├── interceptors/
│   └── etag.interceptor.ts        # MOVED from src/tickets/interceptors/
└── helpers/
    └── if-match.ts                # MOVED from src/tickets/helpers/

src/comments/
├── comments.module.ts
├── comments.controller.ts
├── comments.service.ts
├── comments.service.spec.ts
├── entities/
│   └── comment.entity.ts
└── dto/
    ├── create-comment.dto.ts
    ├── create-comment.dto.spec.ts
    └── update-comment.dto.ts
```

Modified:
- [src/tickets/tickets.controller.ts](../issueflow-typescript/src/tickets/tickets.controller.ts) — update import paths for `EtagInterceptor` + `parseIfMatch`.
- [src/tickets/helpers/](../issueflow-typescript/src/tickets/helpers/) + [src/tickets/interceptors/](../issueflow-typescript/src/tickets/interceptors/) — delete after move (spec files move too).
- [src/app.module.ts](../issueflow-typescript/src/app.module.ts) — import `CommentsModule`.

## Unit Tests (Phase 5)

`comments.service.spec.ts` — mocked `Repository<Comment>`, `TicketsService`, `UsersService`:

1. `create` happy path persists when ticket + author exist.
2. `create` propagates NotFound when ticket missing (`TicketsService.findOne` throws).
3. `create` → 400 when author doesn't exist.
4. `findAllByTicket` validates ticket then returns list.
5. `findOneInTicket` returns when comment under ticket.
6. `findOneInTicket` throws NotFound when comment not under ticket (id exists, ticket mismatch).
7. `update` throws 428 when `expectedVersion` undefined.
8. `update` throws 409 on version mismatch.
9. `update` happy path mutates `content` only and saves.
10. `update` throws NotFound on missing comment.
11. `remove` happy path deletes after path-check.
12. `remove` throws NotFound on missing comment.

`create-comment.dto.spec.ts`:
13. Accepts valid payload.
14. Rejects missing authorId / non-positive authorId.
15. Rejects empty content.
16. Rejects content > 5000 chars.

Total new: **~16 tests.** Running total post-Phase 5: **~99.**

## Acceptance Criteria

- [ ] `npm run build` clean.
- [ ] `npm test` — Phase 4 tests still pass after import moves; ~16 new pass.
- [ ] Live probes (require JWT, a ticket `t1`, and a user `u1`):
  - `POST /tickets/t1/comments` valid → 200 with body shape per README including `mentionedUsers: []` and `ETag: "1"` header.
  - `POST` non-existent ticket → 404.
  - `POST` non-existent author → 400.
  - `POST` empty content → 400 validation.
  - `GET /tickets/t1/comments` → 200 array.
  - `GET` non-existent ticket → 404.
  - `PATCH /tickets/t1/comments/1` without `If-Match` → 428.
  - `PATCH` with stale `If-Match` → 409.
  - `PATCH` with `If-Match "1"` `{content:"new"}` → 200 + `ETag: "2"`; subsequent `GET` confirms.
  - `PATCH` with wrong `ticketId` in path (comment 1 belongs to t1, query as t2/1) → 404.
  - `PATCH` with extra field (e.g. `authorId`) → 400 forbidNonWhitelisted.
  - `DELETE /tickets/t1/comments/1` → 200; subsequent `GET` of that comment id → 404.
  - All routes without JWT → 401.

## Risks / Notes

- **Move-then-import refactor risk.** The refactor of `EtagInterceptor` + `parseIfMatch` from `src/tickets/` to `src/common/` is small but touches two existing test files. Acceptance: Phase 4 test count stays at **33 tests / 4 suites** after the move, no behavior changes.
- **`mentionedUsers: []` placeholder.** Phase 11 will populate it. Until then the field is always empty. Acceptable interim per the cross-phase plan.
- **Hard delete of comments.** Per the assignment rule. A comment deleted via DELETE is gone from the DB; no restore endpoint planned. Audit log (Phase 6) will record the action.
- **Author validation on create only.** If a user is hard-deleted later, their `authorId` becomes a dangling reference (no FK). Acceptable per assignment scope; Phase 14 docs mention it.
- **Comments allowed on DONE tickets.** Spec doesn't restrict this. Reasonable: discussion continues after work is done.
