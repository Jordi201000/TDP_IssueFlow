# Feature 09 — Tickets CSV Export / Import

**Plan:** [feature_plans/09-csv.md](../feature_plans/09-csv.md)
**Approved:** 2026-05-23
**Status:** Done. Build clean. 165/165 unit tests pass. 11 live probes pass, including roundtrip with comma/quote/newline edge cases and the route-collision check.

## What this feature delivers

Two endpoints from spec §3.4 — bulk export and import — built on top of `csv-parse` / `csv-stringify` (already in the skeleton's deps) and the Multer pattern from Phase 8 (memory storage this time). Per-row failures don't abort the batch. Every successful import row goes through `TicketsService.create()` so it inherits the normal validation, response shape, and audit emission.

## Endpoints

| Method | Path | Body / Query | Response | Notes |
|---|---|---|---|---|
| `GET` | `/tickets/export?projectId={id}` | — | `200` CSV body, `Content-Type: text/csv`, `Content-Disposition: attachment; filename="tickets-project-<id>.csv"` | 400 if projectId missing; 404 if project missing |
| `POST` | `/tickets/import` | multipart/form-data: `file` + `projectId` | `200 { created, failed, errors: [{ row, message }] }` | 400 if file/projectId missing; 404 if project missing |

CSV header per README: `id, title, description, status, priority, type, assigneeId`. On import the `id` column is ignored (always auto-generated); `projectId` comes from the form field.

## Key Logic

- **Route-collision avoidance:** `@Get('export')` and `@Post('import')` declared **before** `@Get(':ticketId')` in `TicketsController`. Verified live: `GET /tickets/1` still returns the ticket (not 400 from `ParseIntPipe` on string `"export"`).
- **No separate CsvModule** — `TicketsService` gets `exportProject(projectId)` and `importProject(projectId, buffer, ctx)` methods directly. Avoids a `Tickets ↔ Csv` circular dependency without `forwardRef`.
- **CSV helpers in `src/tickets/csv/ticket-csv.ts`** — pure functions (`serializeTicketsToCsv`, `parseTicketCsv`), unit-testable without Nest.
- **Per-row validation** uses `class-validator` against a constructed `CreateTicketDto` — same rule set as direct creation, no duplicated logic.
- **Per-row audit emit** — each successful import row calls `TicketsService.create(dto, ctx)`, which emits one `CREATE TICKET` audit row. A 100-row import → 100 audit entries. Faithful to spec §3.1 ("all state-changing actions"); accept the noise.
- **Failed rows** report a 1-based row number where header = row 1 and first data row = row 2. Messages come from class-validator's constraint strings or from the underlying create's exception.
- **RFC 4180 quoting** handled transparently by `csv-stringify` / `csv-parse`. Roundtrip preserves commas, embedded quotes, multi-line fields, and BOM-prefixed input.

## How Implemented

| File | Role |
|---|---|
| [src/tickets/csv/ticket-csv.ts](../issueflow-typescript/src/tickets/csv/ticket-csv.ts) | `TICKET_CSV_COLUMNS`, `serializeTicketsToCsv`, `parseTicketCsv`, `ImportSummary` type |
| [src/tickets/csv/ticket-csv.spec.ts](../issueflow-typescript/src/tickets/csv/ticket-csv.spec.ts) | Header check, comma/quote/newline escaping, BOM, empty lines, malformed input |
| [src/tickets/tickets.service.ts](../issueflow-typescript/src/tickets/tickets.service.ts) | **Modified:** `exportProject(projectId)`, `importProject(projectId, buffer, ctx)` |
| [src/tickets/tickets.controller.ts](../issueflow-typescript/src/tickets/tickets.controller.ts) | **Modified:** `@Get('export')` + `@Post('import')` declared at the top of the class |

## Tests

| File | Coverage | # |
|---|---|---|
| [src/tickets/csv/ticket-csv.spec.ts](../issueflow-typescript/src/tickets/csv/ticket-csv.spec.ts) | serialize header-only, serialize simple, quoted commas, escaped quotes, null assigneeId, parse simple, roundtrip quoted, BOM, skip empty lines, throws on malformed | 10 |
| [src/tickets/tickets.service.spec.ts](../issueflow-typescript/src/tickets/tickets.service.spec.ts) (extension) | exportProject returns header; importProject propagates 404; importProject mixed valid/invalid counts | 3 |

`npm test` → **165/165 passing** (5 + 16 + 15 + 14 + 33 + 18 + 16 + 15 + 20 + 13).

## Live Verification (against Postgres on 5433)

11 probes:

```
GET /tickets/export?projectId=1                → 200 + Content-Type: text/csv; charset=utf-8
                                                  Content-Disposition: attachment; filename="tickets-project-1.csv"
  CSV body:
    id,title,description,status,priority,type,assigneeId
    1,"Fix, login bug","users said ""hi""",TODO,HIGH,BUG,
    2,feat A,"line one
    line two",IN_PROGRESS,MEDIUM,FEATURE,
    3,refactor,plain,IN_REVIEW,LOW,TECHNICAL,12

GET /tickets/1                                 → 200 (route-collision check passed)
GET /tickets/export (no projectId)             → 400 ParseIntPipe
POST /tickets/import (roundtrip into dst)      → {created:3, failed:0, errors:[]}
POST /tickets/import (mixed valid/invalid)     → {created:2, failed:2, errors:[
                                                   {row:3, message:"title should not be empty"},
                                                   {row:4, message:"status must be one of..."}]}
POST without file                              → 400
POST without projectId                         → 400
POST with projectId=9999                       → 404
GET /tickets?projectId=2 (dst project)         → titles preserve commas/quotes verbatim
Audit log: TICKET CREATE entries = 8           (3 src + 3 import + 2 mixed valid)
```

## Deviations / Notes

1. **In-memory buffer for imports**, capped at 10 MB by Multer. Adequate for assignment scale; would stream for production.
2. **`projectId` as form field** per README — slightly awkward UX, but literal.
3. **Per-row audit emit** is verbose but spec-faithful. A bulk import logs every successful row.
4. **Permissive MIME** on import — accepts whatever multipart sends; CSV validity is checked by parsing. No restrictive MIME filter (CSV content-types vary: `text/csv`, `application/vnd.ms-excel`, `text/plain`).
5. **No deduplication** — re-importing the same CSV creates new tickets (new ids).

## Cross-cutting Hooks Available for Later Phases

- The `class-transformer + class-validator` roundtrip pattern for "validate without going through the HTTP pipe" is reusable — Phase 11 may want it for `@username` parsing edge cases.
- `csv-parse` / `csv-stringify` proven working with the rest of the stack (sync APIs used; no streaming required).
- Route-ordering pattern (literal routes first, parametric routes last) is now established — Phase 10 will reuse it for `GET /tickets/deleted` (must precede `GET /tickets/:ticketId`).
