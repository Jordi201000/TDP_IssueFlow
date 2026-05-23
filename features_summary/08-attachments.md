# Feature 08 — Attachments (file upload + MIME/size guards)

**Plan:** [feature_plans/08-attachments.md](../feature_plans/08-attachments.md)
**Approved:** 2026-05-23
**Status:** Done. Build clean. 152/152 unit tests pass. 12 live probes pass, including each whitelisted MIME, oversize 413, disallowed-MIME 415, and disk file ↔ DB row consistency.

## What this feature delivers

Two endpoints from spec §3.3 — upload + delete — backed by Multer 2.x with disk storage under `./uploads/<ticketId>/`. Strict MIME whitelist (`image/png`, `image/jpeg`, `application/pdf`, `text/plain`) and 10MB size limit, with proper 415 / 413 mapping via a dedicated exception filter. First multipart endpoint in the project.

## Endpoints

| Method | Path | Body | Status | Notes |
|---|---|---|---|---|
| `POST` | `/tickets/:ticketId/attachments` | multipart/form-data: `file` | 200 / 400 / 404 / 413 / 415 / 401 | Returns `{id, ticketId, filename, contentType}` — internal fields excluded |
| `DELETE` | `/tickets/:ticketId/attachments/:attachmentId` | — | 200 / 404 / 401 | Hard delete; removes disk file + DB row |

## Key Logic

- **Multer 2.x** with `diskStorage`. Destination resolved per-request as `./uploads/<ticketId>/`; `mkdir -p` ensures directory exists. Filenames prefixed with `randomUUID()` + sanitized original name to prevent collisions and path traversal.
- **MIME whitelist** enforced in Multer's `fileFilter`. Disallowed types → `UnsupportedMediaTypeException` (415) with an explicit allowed-list message.
- **Size limit** 10 MB via `limits.fileSize`. Multer throws `MulterError(code: LIMIT_FILE_SIZE)` which is intercepted by the controller-scoped `MulterExceptionFilter` and translated to `PayloadTooLargeException` (413).
- **Filename sanitization** (`sanitizeFilename`): keeps `\w.\-`, replaces everything else with `_`, truncates to 200 chars. Used for both the stored disk-name and the DB `filename` column.
- **Best-effort disk removal** on delete: `fs.rm(storagePath).catch(...)` swallows errors so a missing file doesn't block the DB row deletion.
- **Audit emit** with rich payload on CREATE (`ticketId, filename, contentType, sizeBytes`), slim on DELETE (`filename`).
- **Response shape via `@Exclude()`** on the entity: `sizeBytes`, `storagePath`, `uploadedById`, `createdAt` all hidden by the global `ClassSerializerInterceptor`.

## How Implemented

| File | Role |
|---|---|
| [src/attachments/entities/attachment.entity.ts](../issueflow-typescript/src/attachments/entities/attachment.entity.ts) | `id, ticketId, filename, contentType, sizeBytes, storagePath, uploadedById, createdAt` (last four `@Exclude()`) |
| [src/attachments/multer-options.ts](../issueflow-typescript/src/attachments/multer-options.ts) | `ALLOWED_MIME`, `MAX_FILE_BYTES (10MB)`, `sanitizeFilename`, `isAllowedMime`, `attachmentMulterOptions` |
| [src/attachments/filters/multer-exception.filter.ts](../issueflow-typescript/src/attachments/filters/multer-exception.filter.ts) | Translates Multer errors → `PayloadTooLargeException` / `BadRequestException` |
| [src/attachments/attachments.service.ts](../issueflow-typescript/src/attachments/attachments.service.ts) | create/remove with ticket-existence check, best-effort fs.rm, audit emits |
| [src/attachments/attachments.controller.ts](../issueflow-typescript/src/attachments/attachments.controller.ts) | `@UseFilters(MulterExceptionFilter)`, `FileInterceptor` with `attachmentMulterOptions`, 400 on missing `file` field |
| [src/attachments/attachments.module.ts](../issueflow-typescript/src/attachments/attachments.module.ts) | Imports `TicketsModule` + `AuditLogModule` |
| [issueflow-typescript/package.json](../issueflow-typescript/package.json) | **Modified:** `multer: ^2.0.0` (closes Phase 0 CVE flag) |
| [issueflow-typescript/.gitignore](../issueflow-typescript/.gitignore) | **Modified:** `/uploads` excluded |
| [src/app.module.ts](../issueflow-typescript/src/app.module.ts) | **Modified:** registered `AttachmentsModule` |

## Tests

| File | Coverage | # |
|---|---|---|
| [src/attachments/attachments.service.spec.ts](../issueflow-typescript/src/attachments/attachments.service.spec.ts) | create happy + 404, remove happy + fs error swallow + 404 | 5 |
| [src/attachments/multer-options.spec.ts](../issueflow-typescript/src/attachments/multer-options.spec.ts) | All 4 allowed MIMEs (parameterized), 3 disallowed (parameterized), 4 sanitizeFilename cases, fileFilter happy + reject | 13 |
| [src/attachments/filters/multer-exception.filter.spec.ts](../issueflow-typescript/src/attachments/filters/multer-exception.filter.spec.ts) | LIMIT_FILE_SIZE → 413; other → 400 | 2 |

`npm test` → **152/152 passing** (5 + 16 + 15 + 14 + 33 + 18 + 16 + 15 + 20).

## Live Verification (against Postgres on 5433)

12 probes — every behavior matched the plan:

- `POST` PNG → 200 + `{id, ticketId, filename, contentType}` (no internal fields)
- `POST` PDF → 200; `POST` TXT → 200
- `POST` ZIP → **415** `"MIME type application/zip is not allowed. Allowed: image/png, image/jpeg, application/pdf, text/plain"`
- `POST` 11MB file → **413** `"File too large"`
- `POST` without `file` field → **400** `"Multipart \"file\" field is required"`
- `POST` to ticket 9999 → **404** `"Ticket 9999 not found"`
- `ls uploads/1/` shows 3 files with UUID prefixes: `3089fd20-...test.png`, `6d4db27c-...notes.txt`, `746eb5cb-...doc.pdf`
- `DELETE /tickets/1/attachments/1` → 200; disk file gone (`ls` confirms remaining 2)
- `DELETE` same again → 404 in uniform shape
- No-auth `POST` → 401
- `GET /audit-logs?entityType=ATTACHMENT` shows 3 CREATE entries with full payload + 1 DELETE entry

## Deviations / Notes

1. **No download endpoint** — strictly per README. Files exist on disk after upload but no HTTP retrieval is exposed.
2. **No list-per-ticket endpoint** — README only declares POST/DELETE. To enumerate, query the `attachments` table directly.
3. **`uploads/` is gitignored** — fresh clones start with an empty uploads dir. Any pre-existing DB rows would have dangling `storagePath`. Documented for `run.md` (Phase 14).
4. **Best-effort disk removal** — a missing file on DELETE doesn't block the DB delete; a WARN is logged. Acceptable tradeoff.
5. **Multer 2.x upgrade was clean** — `npm install` removed 15 stale transitive packages and added the new tree. No API changes needed for our use (disk storage + fileFilter).

## Cross-cutting Hooks Available for Later Phases

- `AuditEntityType.ATTACHMENT` is now exercised (was reserved in Phase 6).
- Multer 2.x is now installed and proven to work with NestJS 11 + the `FileInterceptor` pattern. **Phase 9 (CSV Import/Export)** will reuse the same `FileInterceptor` + custom MIME filter pattern for CSV uploads.
- `MulterExceptionFilter` template can be reused for CSV size limits if needed.
- The `sanitizeFilename` helper is generic — usable from any future upload endpoint.
