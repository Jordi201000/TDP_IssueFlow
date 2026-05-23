# Phase 8 — Attachments (file upload + MIME/size guards)

> First multipart endpoint in the project. Uses Multer for upload handling, enforces the spec §3.3 constraints (≤10 MB, allowed MIME types only), and stores files on local disk with DB metadata. Also the right moment to bump Multer 1.x → 2.x (the CVE flag noted back in Phase 0).

## Goal

Two endpoints from §3.3 — upload + delete. Files on disk under `./uploads/<ticketId>/<uuid>-<sanitized-filename>`; metadata in the `attachments` table. Disallowed MIME → 415; oversize → 413; the rest of the contract per README. Audit emit on upload/delete.

## Scope (in)

1. **Bump Multer 1.4.5 → 2.x** in `package.json` (closes the deprecation/CVE warning from Phase 0).
2. `Attachment` entity: `id, ticketId, filename (original), contentType, sizeBytes, storagePath, uploadedById, createdAt`.
3. `MulterModule.register` factory with disk storage, dynamic destination `./uploads/<ticketId>/`, randomized file names, fileFilter for MIME whitelist, `limits.fileSize: 10*1024*1024`.
4. `AttachmentsService`:
   - `create(ticketId, file, uploadedById, ctx?)` — validates ticket exists, persists DB row, returns trimmed shape.
   - `remove(ticketId, attachmentId, ctx?)` — verifies attachment belongs to ticket, deletes DB row + best-effort disk file removal.
5. `AttachmentsController` nested under `/tickets/:ticketId/attachments`.
6. Two custom exception filters or simple exception handling for Multer's `LIMIT_FILE_SIZE` (413) and the fileFilter-thrown MIME error (415).
7. Audit emit (`CREATE`/`DELETE`, `entityType: ATTACHMENT`).
8. `.gitignore` update to exclude `uploads/` (skeleton's `.gitignore` doesn't have it).
9. Unit tests: service + fileFilter helper.

## Scope (out — deferred)

- **Download endpoint** — README doesn't list a GET; staying strict-literal. (Note in `run.md`: files persist on disk, accessible via direct filesystem path, but no HTTP retrieval is exposed.)
- **List attachments per ticket** — README has no such endpoint either. Same approach: strictly per README.
- **Attachment soft delete** — spec §3.5 reserves soft delete for Projects/Tickets; attachments hard-delete.
- **Antivirus scanning, hashing, dedup** — out of scope.
- **Cloud storage (S3 etc.)** — out of scope.

## API Contract (per README, literal)

| Method | Path | Body | Response | Notes |
|---|---|---|---|---|
| `POST` | `/tickets/:ticketId/attachments` | multipart/form-data: `file` | `200 { id, ticketId, filename, contentType }` / 400 / 404 / 413 / 415 | `@HttpCode(200)`; 404 if ticket missing; 413 if > 10MB; 415 if MIME not in whitelist; 400 if `file` field missing |
| `DELETE` | `/tickets/:ticketId/attachments/:attachmentId` | — | `200` (empty) / 404 | 404 if attachment not under that ticket |

Response from POST returns **only** the four README fields (`id, ticketId, filename, contentType`). Internal columns (`sizeBytes, storagePath, uploadedById, createdAt`) are `@Exclude()`d.

## Entity

```ts
@Entity('attachments')
export class Attachment {
  @PrimaryGeneratedColumn() id: number;
  @Column({ name: 'ticket_id' }) ticketId: number;
  @Column({ length: 255 }) filename: string;             // original (sanitized) name
  @Column({ name: 'content_type', length: 100 }) contentType: string;
  @Column({ name: 'size_bytes' }) @Exclude() sizeBytes: number;
  @Column({ name: 'storage_path', length: 500 }) @Exclude() storagePath: string;
  @Column({ name: 'uploaded_by_id' }) @Exclude() uploadedById: number;
  @CreateDateColumn({ name: 'created_at' }) @Exclude() createdAt: Date;
}
```

No FK constraints (consistent with the rest). Ticket existence validated at upload time.

## Multer Options (src/attachments/multer-options.ts)

```ts
export const ALLOWED_MIME = new Set([
  'image/png', 'image/jpeg', 'application/pdf', 'text/plain',
]);

export const MAX_FILE_BYTES = 10 * 1024 * 1024;

export const attachmentMulterOptions: MulterOptions = {
  storage: diskStorage({
    destination: (req, _file, cb) => {
      const ticketId = (req.params as any).ticketId;
      const dir = path.join('uploads', String(ticketId));
      fs.mkdir(dir, { recursive: true }).then(() => cb(null, dir)).catch(cb);
    },
    filename: (_req, file, cb) => {
      const safe = file.originalname.replace(/[^\w.\-]/g, '_').slice(0, 200);
      cb(null, `${randomUUID()}-${safe}`);
    },
  }),
  limits: { fileSize: MAX_FILE_BYTES },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIME.has(file.mimetype)) {
      cb(new UnsupportedMediaTypeException(`MIME type ${file.mimetype} not allowed`), false);
      return;
    }
    cb(null, true);
  },
};
```

`UnsupportedMediaTypeException` is a built-in Nest exception → 415.

For 413 (oversize), Multer throws `MulterError { code: 'LIMIT_FILE_SIZE' }`. Need a small exception filter that translates it to `PayloadTooLargeException` so the global filter renders the uniform shape.

## Service Behaviors

| Method | Behavior |
|---|---|
| `create(ticketId, file, uploadedById, ctx?)` | `TicketsService.findOne(ticketId)` → propagates 404. Persist `{ ticketId, filename: file.originalname (sanitized), contentType: file.mimetype, sizeBytes: file.size, storagePath: file.path, uploadedById }`. Audit emit `CREATE`. Return entity (Exclude-marked fields stripped by global serializer). |
| `remove(ticketId, attachmentId, ctx?)` | Load via `repo.findOne({ where: { id: attachmentId, ticketId } })` → 404 if missing/mismatch. `fs.rm(storagePath).catch(...)` best-effort. `repo.delete(id)`. Audit emit `DELETE`. |

## Exception Filter (Multer translation)

`src/attachments/filters/multer-exception.filter.ts`:
- Catches `MulterError`.
- `code === 'LIMIT_FILE_SIZE'` → rethrow as `PayloadTooLargeException("File exceeds 10 MB limit")`.
- Other Multer errors → `BadRequestException(err.message)`.

Registered as `@UseFilters(MulterExceptionFilter)` on the AttachmentsController (controller-scope, not global — we want Multer errors only translated here).

## File Layout

```
src/attachments/
├── attachments.module.ts
├── attachments.controller.ts
├── attachments.service.ts
├── attachments.service.spec.ts
├── multer-options.ts
├── multer-options.spec.ts
├── filters/
│   ├── multer-exception.filter.ts
│   └── multer-exception.filter.spec.ts
├── entities/
│   └── attachment.entity.ts
```

Modified:
- [issueflow-typescript/package.json](../issueflow-typescript/package.json) — `multer: ^2.0.0`, `@types/multer` if needed.
- [issueflow-typescript/.gitignore](../issueflow-typescript/.gitignore) — add `uploads/`.
- [src/app.module.ts](../issueflow-typescript/src/app.module.ts) — register `AttachmentsModule`.

## Unit Tests (Phase 8)

`attachments.service.spec.ts` — mocked `Repository<Attachment>`, `TicketsService`, `AuditLogService`, `fs.rm`:

1. `create` happy: validates ticket, persists with all fields, emits CREATE audit.
2. `create` propagates 404 when ticket missing.
3. `remove` happy: deletes DB row + calls fs.rm + emits DELETE audit.
4. `remove` swallows fs.rm errors (best-effort).
5. `remove` 404 when attachment not under ticket.

`multer-options.spec.ts` — fileFilter helper exposed for direct testing:
6. Allows `image/png`.
7. Allows `image/jpeg`.
8. Allows `application/pdf`.
9. Allows `text/plain`.
10. Rejects `application/zip` via `UnsupportedMediaTypeException`.
11. Rejects unknown MIME.

`multer-exception.filter.spec.ts`:
12. `LIMIT_FILE_SIZE` MulterError → translates to `PayloadTooLargeException`.
13. Other MulterError → `BadRequestException`.

Total new: **~13 tests.** Running total post-Phase 8: **~145.**

## Acceptance Criteria

- [ ] Build clean. All 132 prior tests still pass. ~13 new pass.
- [ ] `npm install` after multer bump produces no fatal errors.
- [ ] Live probes (require JWT + an existing ticket `t1`):
  - `POST /tickets/t1/attachments` with a valid PNG → 200 with `{ id, ticketId, filename, contentType }`; file exists on disk at `./uploads/<t1>/<uuid>-<name>`; audit row inserted.
  - Same with PDF / JPEG / TXT → 200 (parameterized over the whitelist).
  - Upload with `application/zip` → 415.
  - Upload a >10MB file → 413 in uniform shape.
  - Upload without the `file` field → 400.
  - `POST` to a non-existent ticket → 404.
  - `DELETE /tickets/t1/attachments/<id>` → 200; file no longer on disk; audit row inserted.
  - `DELETE` again → 404.
  - All routes without JWT → 401.

## Risks / Notes

- **Local-disk storage is not horizontally scalable.** Acceptable for assignment scope; documented in `run.md` as a known production gap (would use S3/MinIO).
- **No download endpoint.** Files exist on disk after upload but can only be retrieved out-of-band (via filesystem). Matches README's literal scope.
- **`uploads/` is gitignored** — never committed. Each fresh clone starts empty; existing attachment DB rows would have dangling `storagePath` references. Acceptable; flagged.
- **Filename sanitization** strips characters outside `\w.\-` and truncates to 200 chars. Prevents path traversal and overlong filenames.
- **Multer 2.x API change risk:** the upgrade is mostly transparent for the basic disk-storage + fileFilter use case. Will validate during `npm install` and live boot.
- **No virus scanning** — assignment scope only. A real system would scan via ClamAV or AWS GuardDuty.
