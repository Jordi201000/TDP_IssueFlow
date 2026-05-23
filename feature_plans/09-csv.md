# Phase 9 — Tickets CSV Export / Import

> Bulk ticket migration per spec §3.4. Two endpoints, both on the existing `/tickets` path. Reuses `csv-parse` and `csv-stringify` from the skeleton, plus the Multer 2.x pattern landed in Phase 8 (memory storage this time, not disk). RFC 4180 quoting handled by the libraries — commas/quotes/newlines in field values round-trip correctly.

## Goal

`GET /tickets/export?projectId={id}` returns a CSV file with the README-specified columns. `POST /tickets/import` accepts a CSV file + `projectId` form field and creates tickets in bulk, returning a summary with `{ created, failed, errors[] }`. Per-row failures don't abort the batch. Each successfully-created row goes through `TicketsService.create()` so it gets the normal validation + audit emit.

## Scope (in)

1. `CsvService`:
   - `exportProject(projectId)` → returns a CSV string with header + one row per ticket; correct RFC 4180 quoting via `csv-stringify`.
   - `importProject(projectId, csvBuffer, ctx)` → parses CSV, maps each row to a `CreateTicketDto`, calls `TicketsService.create(dto, ctx)` per row, accumulates failures.
2. Two new methods on `TicketsController`, declared **before** `@Get(':ticketId')` to avoid route collision:
   - `@Get('export')` — sets `Content-Type: text/csv` + `Content-Disposition` headers; returns the CSV body.
   - `@Post('import')` — `@HttpCode(200)`, `FileInterceptor` with memory storage + permissive MIME, `projectId` from form field, returns the summary.
3. `ImportSummary` response type: `{ created: number, failed: number, errors: Array<{ row: number, message: string }> }` per README ("`errors: [...]`" shape is left to us).
4. CSV column contract per README export: `id, title, description, status, priority, type, assigneeId`. Import reads the same header; `id` column is ignored (always auto-generated); `projectId` comes from the form field.
5. Audit emits: **per successfully-imported row** (because each row goes through `TicketsService.create` which already emits). Failures don't audit.
6. Unit tests covering: round-trip of edge-case content (commas, quotes, newlines, empty fields, optional `assigneeId`), invalid row reporting, empty CSV.

## Scope (out — deferred)

- Streaming export (everything is buffered in memory). Acceptable for assignment scale.
- Partial-transaction-on-failure semantics — per spec, failures are reported per row, successes commit.
- Updating tickets via import (only CREATE). Spec only mentions "creates tickets in bulk".
- Custom delimiters / non-UTF-8 encodings — assume UTF-8 + comma.

## API Contract (per README, literal)

| Method | Path | Body / Query | Response | Notes |
|---|---|---|---|---|
| `GET` | `/tickets/export?projectId={id}` | — | `200` CSV body, `Content-Type: text/csv`, `Content-Disposition: attachment; filename="tickets-project-<id>.csv"` | 400 if `projectId` missing; 404 if project missing |
| `POST` | `/tickets/import` | multipart/form-data: `file` + `projectId` (form field) | `200 { created, failed, errors: [{ row, message }] }` | 400 if `file` missing or `projectId` missing; 404 if project missing |

## Route Collision Resolution

`/tickets/export` could collide with `/tickets/:ticketId` (a string "export" would attempt `ParseIntPipe → 400`). Resolution: declare `@Get('export')` **before** `@Get(':ticketId')` in `TicketsController`. Express's router matches in declaration order; the literal `export` segment wins. Same for `@Post('import')` vs `@Post()`.

Tested live as part of acceptance — if a collision were unresolved, `GET /tickets/export?projectId=1` would return 400 from ParseIntPipe instead of a CSV.

## CSV Format

**Export header** (RFC 4180):
```
id,title,description,status,priority,type,assigneeId
```

**Example row** with edge cases:
```
1,"Fix, login bug","User can't ""log in"" on mobile",TODO,HIGH,BUG,2
```

`csv-stringify` handles quoting automatically (`{ header: true, columns: [...] }`).

**Import:** `csv-parse` with `{ columns: true, skip_empty_lines: true, trim: true, bom: true }`. Records arrive as `Record<string, string>`. Per-row validation:
- `title`, `description`, `status`, `priority`, `type` required and non-empty.
- `status` ∈ `TicketStatus`, `priority` ∈ `TicketPriority`, `type` ∈ `TicketType`.
- `assigneeId` optional; if present must be a positive integer.

Validation re-uses `class-validator` on a constructed `CreateTicketDto` (via `validate(dto)`) to keep the rules in one place. Any row that fails validation or whose `TicketsService.create` throws is reported in `errors`.

## File Layout

```
src/csv/
├── csv.module.ts
├── csv.service.ts
├── csv.service.spec.ts
└── dto/
    └── import-summary.dto.ts          # response type interface
```

Modified:
- [src/tickets/tickets.controller.ts](../issueflow-typescript/src/tickets/tickets.controller.ts) — two new methods declared first; `CsvService` injected.
- [src/tickets/tickets.module.ts](../issueflow-typescript/src/tickets/tickets.module.ts) — imports `CsvModule`.
- `CsvModule` imports `TicketsModule` for `TicketsService` access — **risk of circular import** between Csv and Tickets. Mitigation: put `CsvService` in its own module, but have it depend on `TicketsService` via `forwardRef(() => TicketsModule)`. Plan-time alternative: just put the export/import methods inline in `TicketsService` (no separate module/service). Cleaner; less ceremony.

**Revised file layout (no separate module):**
```
src/tickets/
├── tickets.service.ts          # gains exportProject / importProject methods
├── csv/                        # helper utilities only
│   ├── ticket-csv.ts           # serializeRows + parseRows + ImportSummary type
│   └── ticket-csv.spec.ts      # round-trip + edge cases
```

This avoids the circular module problem entirely. `TicketsService` exposes `exportProject(projectId): string` and `importProject(projectId, buffer, ctx): ImportSummary`. The controller just delegates.

## Service Behaviors

`TicketsService.exportProject(projectId)`:
1. `findAllByProject(projectId)` — uses existing method; soft-deleted hidden.
2. `serializeTicketsToCsv(tickets)` — helper; uses `csv-stringify`.
3. Returns string.

`TicketsService.importProject(projectId, buffer, ctx)`:
1. `projects.findOne(projectId)` — 404 if missing.
2. `parseTicketCsv(buffer)` — array of `{ row: number, data: Record<string, string> }`.
3. For each row:
   - Validate via `class-validator` on a constructed DTO.
   - On invalid: push `{ row, message }`, continue.
   - On valid: `await this.create(dto, ctx).catch(err => push)`.
4. Return `{ created, failed, errors }`.

Audit emits flow naturally through `TicketsService.create(dto, ctx)` for each successful row.

## Controller Snippets

```ts
// TicketsController — NEW METHODS, declared first
@Get('export')
async export(
  @Query('projectId', ParseIntPipe) projectId: number,
  @Res({ passthrough: true }) res: Response,
): Promise<string> {
  const csv = await this.tickets.exportProject(projectId);
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="tickets-project-${projectId}.csv"`);
  return csv;
}

@Post('import')
@HttpCode(HttpStatus.OK)
@UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 10*1024*1024 } }))
async import(
  @UploadedFile() file: Express.Multer.File | undefined,
  @Body() body: { projectId?: string },
  @CurrentUser() me: AuthenticatedUser,
): Promise<ImportSummary> {
  if (!file) throw new BadRequestException('Multipart "file" field is required');
  const projectId = Number(body.projectId);
  if (!Number.isInteger(projectId) || projectId <= 0) {
    throw new BadRequestException('projectId form field is required and must be a positive integer');
  }
  return this.tickets.importProject(projectId, file.buffer, {
    actor: AuditActor.USER,
    performedBy: me.userId,
  });
}
```

Note: `projectId` arrives as a form field (string), parsed manually since `ValidationPipe` doesn't directly transform multipart fields.

## Unit Tests (Phase 9)

`ticket-csv.spec.ts` — helper round-trip tests, no Nest required:

1. `serializeTicketsToCsv` produces header + rows in column order.
2. Roundtrip: fields containing commas survive (`"Fix, login bug"`).
3. Roundtrip: fields containing quotes survive (escaped as `""`).
4. Roundtrip: fields containing newlines survive (quoted multi-line).
5. Empty tickets array yields header-only output.
6. `parseTicketCsv` rejects malformed CSV (returns row indices for bad rows).
7. `parseTicketCsv` handles BOM-prefixed input (common Excel export).
8. `parseTicketCsv` trims whitespace.

`tickets.service.spec.ts` extension:

9. `importProject` counts created vs failed for a mixed-validity payload.
10. `importProject` propagates 404 when project missing.
11. `exportProject` returns string starting with the expected header.
12. `importProject` calls `create()` (and hence audit) per valid row.

Total new: **~12 tests.** Running total post-Phase 9: **~164.**

## Acceptance Criteria

- [ ] Build clean. All 152 prior tests still pass; ~12 new pass.
- [ ] Live probes (require JWT + a project with tickets):
  - `GET /tickets/export?projectId=<pid>` → 200 with `Content-Type: text/csv` and `Content-Disposition` header; body matches expected header + rows.
  - `GET /tickets/export` (no projectId) → 400.
  - Roundtrip: create a ticket with a comma + quotes in description, export, re-import to another project → ticket count goes up; description matches original.
  - `POST /tickets/import` with valid CSV + `projectId` → `{ created: N, failed: 0, errors: [] }`.
  - `POST /tickets/import` with mixed valid/invalid rows → `{ created, failed, errors: [{row, message}] }` with correct counts.
  - `POST /tickets/import` without `file` → 400.
  - `POST /tickets/import` without `projectId` → 400.
  - `POST /tickets/import` with `projectId` for a non-existent project → 404.
  - All routes without JWT → 401.
  - Audit log shows one `CREATE TICKET` per successfully imported row.

## Risks / Notes

- **In-memory buffer for imports** capped at 10MB by Multer. Realistic for assignment; would stream for production.
- **`projectId` as form field** (not query) per README — slight UX wrinkle; documented.
- **Failed-row error messages** come from `class-validator` for invalid fields and from `TicketsService` for duplicate/FK errors. Not super-pretty for end users; passable for an API.
- **No deduplication on import** — re-importing the same CSV creates new tickets (with new ids). Acceptable per spec ("creates tickets in bulk", no upsert).
- **Route collision risk on `/tickets/export`** mitigated by method order in `TicketsController`. Live verification will confirm.
