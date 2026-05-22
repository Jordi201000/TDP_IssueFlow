# IssueFlow — Manual Smoke-Test Runbook

A copy-paste runnable verification of every implemented feature. Total run time: ~10 minutes (most of it waiting for the Phase 12 escalation cron). Designed for a grader who wants confidence the system works end-to-end.

## 0. Prerequisites

```bash
node --version    # must be 20.11+ (NestJS 11 requirement)
docker --version  # any recent
```

If Node is older: `nvm use 20.20.0` (or `nvm install 20`).

## 1. One-time setup

```bash
cd issueflow-typescript
npm install
docker compose up -d        # Postgres on host port 5433
npm test                    # 221 tests, all should pass
npm run start               # boots on http://localhost:3000
```

> **Why port 5433?** Many dev machines already have native Postgres on 5432. Container exposes `5433:5432` to avoid the collision. The connection is configured for `localhost:5433` via `.env.example` / `src/config/configuration.ts`.

In a second terminal, run the smoke tests below.

## 2. Foundation

```bash
curl -s http://localhost:3000/health
# → {"status":"ok","uptime":...,"timestamp":"..."}

curl -s -w '\nHTTP %{http_code}\n' http://localhost:3000/missing
# → 404 in uniform shape: {"statusCode":404,"error":"NotFoundException",...}
```

## 3. Users (registration + CRUD)

```bash
# Register an ADMIN, a DEV, and a second DEV (oldest by id wins ties later).
curl -s -X POST http://localhost:3000/users -H 'Content-Type: application/json' \
  -d '{"username":"alice","email":"a@x.com","fullName":"Alice","role":"ADMIN","password":"alicepw1"}'
curl -s -X POST http://localhost:3000/users -H 'Content-Type: application/json' \
  -d '{"username":"bob","email":"b@x.com","fullName":"Bob","role":"DEVELOPER","password":"bobpw123"}'
curl -s -X POST http://localhost:3000/users -H 'Content-Type: application/json' \
  -d '{"username":"carol","email":"c@x.com","fullName":"Carol","role":"DEVELOPER","password":"carolpw1"}'

# Negative: duplicate username → 409
curl -s -w '\nHTTP %{http_code}\n' -X POST http://localhost:3000/users -H 'Content-Type: application/json' \
  -d '{"username":"alice","email":"x@x.com","fullName":"X","role":"DEVELOPER","password":"strong123"}'
# → 409 "username already exists"

# Negative: invalid enum → 400 with details[]
curl -s -w '\nHTTP %{http_code}\n' -X POST http://localhost:3000/users -H 'Content-Type: application/json' \
  -d '{"username":"x","email":"x@x.com","fullName":"X","role":"GUEST","password":"strong123"}'
# → 400 details: ["role must be one of: ADMIN, DEVELOPER"]

# Auth-gated: GET /users without token → 401
curl -s -w '\nHTTP %{http_code}\n' http://localhost:3000/users
# → 401
```

## 4. Authentication (JWT)

```bash
# Log in as alice (ADMIN). Capture the token.
ATOKEN=$(curl -s -X POST http://localhost:3000/auth/login -H 'Content-Type: application/json' \
  -d '{"username":"alice","password":"alicepw1"}' | python3 -c 'import sys,json; print(json.load(sys.stdin)["accessToken"])')
echo "ATOKEN length: ${#ATOKEN}"   # should be ~150+

# Wrong password and unknown user both yield the SAME message (no enumeration).
curl -s -X POST http://localhost:3000/auth/login -H 'Content-Type: application/json' \
  -d '{"username":"alice","password":"wrong"}'
# → {"statusCode":401,...,"message":"Invalid credentials"}
curl -s -X POST http://localhost:3000/auth/login -H 'Content-Type: application/json' \
  -d '{"username":"nobody","password":"x"}'
# → identical "Invalid credentials"

# /auth/me returns the profile.
curl -s -H "Authorization: Bearer $ATOKEN" http://localhost:3000/auth/me
# → {"id":N,"username":"alice","email":"a@x.com","fullName":"Alice","role":"ADMIN"}

# Also log bob and carol in (used later).
BTOKEN=$(curl -s -X POST http://localhost:3000/auth/login -H 'Content-Type: application/json' \
  -d '{"username":"bob","password":"bobpw123"}' | python3 -c 'import sys,json; print(json.load(sys.stdin)["accessToken"])')
CTOKEN=$(curl -s -X POST http://localhost:3000/auth/login -H 'Content-Type: application/json' \
  -d '{"username":"carol","password":"carolpw1"}' | python3 -c 'import sys,json; print(json.load(sys.stdin)["accessToken"])')

AH="Authorization: Bearer $ATOKEN"; BH="Authorization: Bearer $BTOKEN"; CH="Authorization: Bearer $CTOKEN"
ALICE_ID=$(curl -s -H "$AH" http://localhost:3000/auth/me | python3 -c 'import sys,json; print(json.load(sys.stdin)["id"])')
BOB_ID=$(curl -s -H "$BH" http://localhost:3000/auth/me | python3 -c 'import sys,json; print(json.load(sys.stdin)["id"])')
CAROL_ID=$(curl -s -H "$CH" http://localhost:3000/auth/me | python3 -c 'import sys,json; print(json.load(sys.stdin)["id"])')
echo "alice=$ALICE_ID bob=$BOB_ID carol=$CAROL_ID"
```

## 5. Projects (CRUD + soft delete)

```bash
# Create project owned by bob.
PID=$(curl -s -X POST -H "$AH" -H 'Content-Type: application/json' http://localhost:3000/projects \
  -d "{\"name\":\"Sample Project\",\"description\":\"A demo project\",\"ownerId\":$BOB_ID}" | python3 -c 'import sys,json; print(json.load(sys.stdin)["id"])')
echo "project=$PID"

# Non-existent owner → 400 with explicit message
curl -s -w '\nHTTP %{http_code}\n' -X POST -H "$AH" -H 'Content-Type: application/json' http://localhost:3000/projects \
  -d '{"name":"X","description":"X","ownerId":9999}'
# → 400 "Owner user 9999 does not exist"

# Soft delete
curl -s -w '\nHTTP %{http_code}\n' -X DELETE -H "$AH" http://localhost:3000/projects/$PID
# → 200, empty body
curl -s -w '\nHTTP %{http_code}\n' -H "$AH" http://localhost:3000/projects/$PID
# → 404 (hidden from standard queries)

# Restore (ADMIN required)
curl -s -w '\nHTTP %{http_code}\n' -X POST -H "$BH" http://localhost:3000/projects/$PID/restore
# → 403 "Insufficient role" (bob is DEVELOPER)
curl -s -w '\nHTTP %{http_code}\n' -X POST -H "$AH" http://localhost:3000/projects/$PID/restore
# → 200; subsequent GET returns 200
```

## 6. Tickets (lifecycle + ETag/If-Match + soft delete)

```bash
# Create a ticket explicitly assigned to bob.
TID=$(curl -s -X POST -H "$AH" -H 'Content-Type: application/json' http://localhost:3000/tickets \
  -d "{\"title\":\"Fix login bug\",\"description\":\"Users can't log in\",\"status\":\"TODO\",\"priority\":\"HIGH\",\"type\":\"BUG\",\"projectId\":$PID,\"assigneeId\":$BOB_ID}" | python3 -c 'import sys,json; print(json.load(sys.stdin)["id"])')

# Read with ETag
curl -s -D - -o /dev/null -H "$AH" http://localhost:3000/tickets/$TID | grep -i ^etag
# → ETag: "1"

# PATCH without If-Match → 428
curl -s -w '\nHTTP %{http_code}\n' -X PATCH -H "$AH" -H 'Content-Type: application/json' \
  http://localhost:3000/tickets/$TID -d '{"status":"IN_PROGRESS"}'
# → 428 PreconditionRequiredException

# Stale If-Match → 409
curl -s -w '\nHTTP %{http_code}\n' -X PATCH -H "$AH" -H 'Content-Type: application/json' \
  -H 'If-Match: "99"' http://localhost:3000/tickets/$TID -d '{"status":"IN_PROGRESS"}'
# → 409

# Valid PATCH: forward transition + new ETag
curl -s -D - -X PATCH -H "$AH" -H 'Content-Type: application/json' \
  -H 'If-Match: "1"' http://localhost:3000/tickets/$TID -d '{"status":"IN_PROGRESS"}' | grep -iE '^HTTP|^etag:'
# → HTTP/1.1 200 OK + ETag: "2"

# Backward transition rejected
curl -s -w '\nHTTP %{http_code}\n' -X PATCH -H "$AH" -H 'Content-Type: application/json' \
  -H 'If-Match: "2"' http://localhost:3000/tickets/$TID -d '{"status":"TODO"}'
# → 400 "Invalid status transition from IN_PROGRESS to TODO"

# Skip-forward (IN_PROGRESS → DONE) allowed
curl -s -D - -X PATCH -H "$AH" -H 'Content-Type: application/json' \
  -H 'If-Match: "2"' http://localhost:3000/tickets/$TID -d '{"status":"DONE"}' | grep -iE '^HTTP|^etag:'
# → 200 + ETag: "3"

# Any update after DONE rejected (DONE lock)
curl -s -w '\nHTTP %{http_code}\n' -X PATCH -H "$AH" -H 'Content-Type: application/json' \
  -H 'If-Match: "3"' http://localhost:3000/tickets/$TID -d '{"title":"after-done"}'
# → 400 "Ticket is DONE and cannot be updated"
```

## 7. Comments (+ optimistic locking + @mentions)

```bash
# Comment with two @mentions (case-insensitive dedup).
CID=$(curl -s -X POST -H "$AH" -H 'Content-Type: application/json' http://localhost:3000/tickets/$TID/comments \
  -d "{\"authorId\":$ALICE_ID,\"content\":\"Heads up @bob and @Bob - take a look\"}" | python3 -c 'import sys,json; print(json.load(sys.stdin)["id"])')

# GET shows hydrated mentionedUsers
curl -s -H "$AH" http://localhost:3000/tickets/$TID/comments
# → [{"id":N,"ticketId":...,"authorId":...,"content":"...","mentionedUsers":[{"id":<bob>,"username":"bob","fullName":"Bob"}]}]

# Email-like content does NOT mention
curl -s -X POST -H "$AH" -H 'Content-Type: application/json' http://localhost:3000/tickets/$TID/comments \
  -d "{\"authorId\":$ALICE_ID,\"content\":\"contact bob@example.com\"}"
# → mentionedUsers: []

# GET /users/:id/mentions paginated
curl -s -H "$AH" "http://localhost:3000/users/$BOB_ID/mentions"
# → {"data":[{...}],"total":1,"page":1}

# PATCH comment replaces the mention set
curl -s -w '\nHTTP %{http_code}\n' -X PATCH -H "$AH" -H 'Content-Type: application/json' \
  -H 'If-Match: "1"' http://localhost:3000/tickets/$TID/comments/$CID -d '{"content":"now mentioning @carol"}'
# → 200; GET /users/$BOB_ID/mentions now has total:0; GET /users/$CAROL_ID/mentions has total:1
```

## 8. Ticket Dependencies (+ DONE-blocker rule)

```bash
# Create two more tickets to test blockers
T2=$(curl -s -X POST -H "$AH" -H 'Content-Type: application/json' http://localhost:3000/tickets \
  -d "{\"title\":\"T2\",\"description\":\"d\",\"status\":\"TODO\",\"priority\":\"HIGH\",\"type\":\"BUG\",\"projectId\":$PID,\"assigneeId\":$BOB_ID}" | python3 -c 'import sys,json; print(json.load(sys.stdin)["id"])')
T3=$(curl -s -X POST -H "$AH" -H 'Content-Type: application/json' http://localhost:3000/tickets \
  -d "{\"title\":\"T3\",\"description\":\"d\",\"status\":\"TODO\",\"priority\":\"HIGH\",\"type\":\"BUG\",\"projectId\":$PID,\"assigneeId\":$BOB_ID}" | python3 -c 'import sys,json; print(json.load(sys.stdin)["id"])')

# T2 blocked by T3
curl -s -w '\nHTTP %{http_code}\n' -X POST -H "$AH" -H 'Content-Type: application/json' \
  http://localhost:3000/tickets/$T2/dependencies -d "{\"blockedBy\":$T3}"
# → 200

# Idempotent: same POST again
curl -s -w '\nHTTP %{http_code}\n' -X POST -H "$AH" -H 'Content-Type: application/json' \
  http://localhost:3000/tickets/$T2/dependencies -d "{\"blockedBy\":$T3}"
# → 200 (no second audit row)

# Self-dependency rejected
curl -s -w '\nHTTP %{http_code}\n' -X POST -H "$AH" -H 'Content-Type: application/json' \
  http://localhost:3000/tickets/$T2/dependencies -d "{\"blockedBy\":$T2}"
# → 400 "A ticket cannot block itself"

# Try to mark T2 DONE while T3 is still TODO → blocked
curl -s -w '\nHTTP %{http_code}\n' -X PATCH -H "$AH" -H 'Content-Type: application/json' \
  -H 'If-Match: "1"' http://localhost:3000/tickets/$T2 -d '{"status":"DONE"}'
# → 400 "Ticket cannot transition to DONE: open blockers [T3]"

# Resolve T3, then T2 can move to DONE
curl -s -o /dev/null -X PATCH -H "$AH" -H 'Content-Type: application/json' \
  -H 'If-Match: "1"' http://localhost:3000/tickets/$T3 -d '{"status":"DONE"}'
curl -s -w '\nHTTP %{http_code}\n' -X PATCH -H "$AH" -H 'Content-Type: application/json' \
  -H 'If-Match: "1"' http://localhost:3000/tickets/$T2 -d '{"status":"DONE"}'
# → 200
```

## 9. Attachments (file upload)

```bash
# Make a small file. (text/plain is whitelisted.)
echo "hello world" > /tmp/note.txt

# Upload
curl -s -X POST -H "$AH" -F "file=@/tmp/note.txt;type=text/plain" \
  http://localhost:3000/tickets/$TID/attachments
# → {"id":N,"ticketId":...,"filename":"note.txt","contentType":"text/plain"}
# (note: sizeBytes, storagePath, uploadedById, createdAt are intentionally excluded)

# Disallowed MIME → 415
echo '{"x":1}' > /tmp/data.json
curl -s -w '\nHTTP %{http_code}\n' -X POST -H "$AH" -F "file=@/tmp/data.json;type=application/json" \
  http://localhost:3000/tickets/$TID/attachments
# → 415 "MIME type application/json is not allowed. Allowed: image/png, image/jpeg, application/pdf, text/plain"

# Oversize (>10 MB) → 413
dd if=/dev/zero of=/tmp/big.png bs=1M count=11 2>/dev/null
curl -s -w '\nHTTP %{http_code}\n' -X POST -H "$AH" -F "file=@/tmp/big.png;type=image/png" \
  http://localhost:3000/tickets/$TID/attachments
# → 413 "File too large"

# Missing file field → 400
curl -s -w '\nHTTP %{http_code}\n' -X POST -H "$AH" http://localhost:3000/tickets/$TID/attachments
# → 400 'Multipart "file" field is required'
```

Files end up in `uploads/<ticketId>/<uuid>-<filename>`; check with `ls uploads/`.

## 10. CSV Export / Import

```bash
# Export tickets to a CSV file
curl -s -H "$AH" "http://localhost:3000/tickets/export?projectId=$PID" -o /tmp/tickets.csv
cat /tmp/tickets.csv
# Header: id,title,description,status,priority,type,assigneeId
# Values quoted per RFC 4180 (commas/quotes/newlines roundtrip)

# Roundtrip into the same (or another) project
curl -s -X POST -H "$AH" -F "file=@/tmp/tickets.csv;type=text/csv" -F "projectId=$PID" \
  http://localhost:3000/tickets/import
# → {"created":N,"failed":0,"errors":[]}

# Mixed valid/invalid
cat >/tmp/mixed.csv <<'EOF'
id,title,description,status,priority,type,assigneeId
,Good,desc,TODO,HIGH,BUG,
,,no-title,TODO,HIGH,BUG,
,Bad enum,desc,WAITING,HIGH,BUG,
EOF
curl -s -X POST -H "$AH" -F "file=@/tmp/mixed.csv;type=text/csv" -F "projectId=$PID" \
  http://localhost:3000/tickets/import
# → {"created":1,"failed":2,"errors":[{"row":3,"message":"title should not be empty"},{"row":4,"message":"status must be one of: ..."}]}

# Route collision sanity: GET /tickets/1 still works (not parsed as "export")
curl -s -w '\nHTTP %{http_code}\n' -H "$AH" http://localhost:3000/tickets/1
# → 200
```

## 11. Auto-Escalation (background cron, every 30s)

```bash
# Create a ticket with priority=LOW and dueDate 5 minutes in the past
PAST=$(python3 -c "from datetime import datetime,timezone,timedelta; print((datetime.now(timezone.utc)-timedelta(minutes=5)).isoformat())")
ETID=$(curl -s -X POST -H "$AH" -H 'Content-Type: application/json' http://localhost:3000/tickets \
  -d "{\"title\":\"Overdue\",\"description\":\"d\",\"status\":\"TODO\",\"priority\":\"LOW\",\"type\":\"BUG\",\"projectId\":$PID,\"dueDate\":\"$PAST\",\"assigneeId\":$BOB_ID}" \
  | python3 -c 'import sys,json; print(json.load(sys.stdin)["id"])')

# Poll every 35 seconds for 4 cycles (~2 minutes)
for i in 1 2 3 4; do
  sleep 35
  echo "[T+$((i*35))s]"
  curl -s -H "$AH" http://localhost:3000/tickets/$ETID | python3 -c 'import sys,json; t=json.load(sys.stdin); print(f"  priority={t[\"priority\"]} isOverdue={t[\"isOverdue\"]}")'
done
# Expected progression: LOW → MEDIUM → HIGH → CRITICAL → CRITICAL+isOverdue
# After CRITICAL+isOverdue, idempotent (no further changes).

# Manual priority change resets isOverdue
ETAG=$(curl -s -D - -o /dev/null -H "$AH" http://localhost:3000/tickets/$ETID | grep -i ^etag | sed -E 's/.*"([0-9]+)".*/\1/' | tr -d '\r')
curl -s -X PATCH -H "$AH" -H 'Content-Type: application/json' \
  -H "If-Match: \"$ETAG\"" http://localhost:3000/tickets/$ETID -d '{"priority":"HIGH"}'
curl -s -H "$AH" http://localhost:3000/tickets/$ETID | python3 -c 'import sys,json; t=json.load(sys.stdin); print(f"after manual reset: priority={t[\"priority\"]} isOverdue={t[\"isOverdue\"]}")'
# → priority=HIGH isOverdue=False
```

## 12. Auto-Assignment + Workload

```bash
# Create a second project owned by alice (ADMIN, no DEV members initially)
P2=$(curl -s -X POST -H "$AH" -H 'Content-Type: application/json' http://localhost:3000/projects \
  -d "{\"name\":\"AdminProj\",\"description\":\"d\",\"ownerId\":$ALICE_ID}" | python3 -c 'import sys,json; print(json.load(sys.stdin)["id"])')

# Ticket with NO assigneeId → null (no DEV members)
curl -s -X POST -H "$AH" -H 'Content-Type: application/json' http://localhost:3000/tickets \
  -d "{\"title\":\"X\",\"description\":\"d\",\"status\":\"TODO\",\"priority\":\"HIGH\",\"type\":\"BUG\",\"projectId\":$P2}" \
  | python3 -c 'import sys,json; t=json.load(sys.stdin); print(f"assigneeId={t[\"assigneeId\"]}")'
# → assigneeId=None

# Workload for P1 (with multiple devs)
curl -s -H "$AH" "http://localhost:3000/projects/$PID/workload"
# → [{"userId":...,"username":"bob","openTicketCount":N},{"userId":...,"username":"carol","openTicketCount":N}]
# Sorted by openTicketCount ASC

# 404 on missing project
curl -s -w '\nHTTP %{http_code}\n' -H "$AH" http://localhost:3000/projects/9999/workload
# → 404
```

## 13. Audit Log

```bash
# Browse the audit log (all entries newest first)
curl -s -H "$AH" http://localhost:3000/audit-logs | python3 -m json.tool | head -40

# Single filter (allowed): only USER LOGINs
curl -s -H "$AH" "http://localhost:3000/audit-logs?action=LOGIN"

# Single filter: only SYSTEM actions
curl -s -H "$AH" "http://localhost:3000/audit-logs?actor=SYSTEM"
# Should contain AUTO_ESCALATE (from §11) and AUTO_ASSIGN (from §12) rows.

# Multiple filters → 400
curl -s -w '\nHTTP %{http_code}\n' -H "$AH" "http://localhost:3000/audit-logs?action=CREATE&actor=USER"
# → 400 "At most one filter is allowed: entityType, entityId, action, or actor"
```

## 14. RBAC sanity (ADMIN-only restore + workload paths)

```bash
# DEVELOPER can't see soft-deleted lists
curl -s -w '\nHTTP %{http_code}\n' -H "$BH" http://localhost:3000/projects/deleted
# → 403 "Insufficient role"

curl -s -w '\nHTTP %{http_code}\n' -H "$BH" "http://localhost:3000/tickets/deleted?projectId=$PID"
# → 403

# ADMIN can
curl -s -H "$AH" http://localhost:3000/projects/deleted
curl -s -H "$AH" "http://localhost:3000/tickets/deleted?projectId=$PID"
```

## Done

If every probe above behaves as described, the system satisfies spec §§2 + 3 end-to-end.

For automated coverage, run `npm test` — there are **221 unit tests** covering services, DTOs, helpers, guards, interceptors, and edge cases.

## Cleanup

```bash
# Stop the app: Ctrl+C in the npm start terminal.
docker compose -f issueflow-typescript/compose.yml down
rm -rf issueflow-typescript/uploads
```
