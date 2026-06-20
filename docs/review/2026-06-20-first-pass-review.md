# kanban-mcp — First-Pass Review (2026-06-20)

Branch: `planka-v2.1-compat`. This is the first working session on the repo (a
fork of `bradrisse/mcp-kanban`). Goal: give it a real test suite, lock the v2.1
route contract behind regression tests, stand up Planka 2.1.1 and prove the
integration suite passes, add CI + lint, and review what's here.

## What landed this session

| Commit | Summary |
|---|---|
| `f4316a4` | Split Jest harness into unit (default, CI-safe) + integration suites |
| `8d3411b` | Unit suite (51 tests) locking the v2.1 route contract |
| `a91aac8` | Live-integration harness: image pin + provisioning scripts |
| `c3d3465` | Complete v2.1 compat for the create-chain + task schema |
| `470b259` | Lock v2.1 create-chain `type` behavior in unit suite (→ 55 tests) |
| `e38dd75` | Biome, scoped to newly-authored code |
| `96b6ce8` | GitHub Actions (fast PR checks + manual live integration) |
| `3797935` | Cheap-fix drift: version sync, drop dead node-fetch, doc accuracy |

## Verification evidence

- `npm run build` → tsc clean (exit 0).
- `npm run test:unit` → **55/55 pass** (was 51; +4 for the create-chain lock).
- `npm run test:coverage` → coverage on `common/*` (errors 100%, utils ~73%,
  types/version 100%) and the four v2.1 op modules.
- **Live:** Planka 2.1.1 via `npm run up`, terms accepted via
  `scripts/accept-planka-terms.sh`, `npm run test:integration` → **36/36 pass**.
- `npm run lint` (Biome, scoped to new files) → 11 files, clean.

## Findings from live verification (this session)

These were discovered by running against a real Planka 2.1.1 container — they
are the most consequential findings and are not theoretical.

### F1 — Auth has no handling for Planka 2.1.x's terms-acceptance gate (Important)
`common/utils.ts` `authenticateAgent` expects `POST /api/access-tokens` to return
`{ item: <token> }`. On a **clean** Planka 2.1.x, the first login instead returns
HTTP 403 with a `pendingToken` and `step: "accept-terms"`; no token is issued
until terms are accepted once. The server cannot authenticate against such an
instance — it works only where an admin already accepted terms via the web UI
(which is why commit `764821a`'s "verified against Planka 2.1.1" held on the
homelab but not on a fresh container).
- **Mitigation shipped:** `scripts/accept-planka-terms.sh` provisions an instance
  (login → pendingToken → `GET /api/terms` signature → `POST /api/access-tokens/accept-terms`).
- **Recommended follow-up:** either teach `authenticateAgent` to surface a clear,
  actionable error on a 403 `accept-terms` response, or optionally complete the
  flow automatically. Tracked as a follow-up (behavior change, out of this pass).

### F2 — Create-chain required `type` for 2.1.x (Resolved this session)
Planka 2.1.x made `type` required on `POST /api/projects` (`private|shared`),
`POST /api/boards/:id/lists` (`active|closed`), and `POST /api/lists/:id/cards`
(`project|story`). The MCP operations didn't send it, so creation 400'd. Fixed in
`operations/lists.ts` (default `active`) and `operations/cards.ts` (default
`project`), both with an optional override exposed on the schema; the integration
test's project helper now sends `type: "private"`. `createProject` has no MCP
path (index.ts only reads projects), so only the test helper needed it.

### F3 — `PlankaTaskSchema` required `cardId` (Resolved this session)
Planka 2.1.x nests tasks under task lists: a task carries `taskListId`, not
`cardId`. `common/types.ts` `PlankaTaskSchema` required `cardId`, so `updateTask`
(which parses with it) threw a ZodError. Made `cardId` optional and added
`taskListId` + `linkedCardId`.

## Findings carried forward (documented, NOT fixed this pass)

### C1 — Error-swallowing operations mask failures (Important follow-up)
Several functions catch errors and return `[]`/`null`, so a real failure
(network, auth, 5xx) is indistinguishable from "no data":
- `common/utils.ts` `getUserIdByEmail` / `getUserIdByUsername` → `null`
- `operations/comments.ts` `getComments` → `[]`
- `operations/labels.ts` `getLabels` → `[]`
- `operations/boardMemberships.ts` `getBoardMemberships` → `[]`
The board-summary tool aggregates several of these, so a transient failure can
silently render an empty board. Recommend distinguishing "empty" from "errored".

### C2 — Hardcoded credentials in `package.json` (Nit/hygiene)
`inspector:demo` embeds `PLANKA_AGENT_EMAIL`, `PLANKA_AGENT_PASSWORD`, and a
`PLANKA_ADMIN_ID` in the committed script. Even if throwaway, prefer env/.env.

### C3 — Module-level mutable state
`operations/tasks.ts` `taskCardIdMap` (grows unbounded; only populated by
`createTask`, so `getTask` by id fails for tasks this process didn't create) and
`common/utils.ts` `agentToken` (never invalidated on 401 — a revoked/expired
token is retried forever). Both are pre-existing; worth a follow-up.

## Cheap fixes applied (commit `3797935`)
- Version drift: `package.json` `0.0.6` → `0.1.0` (matches `common/version.ts`).
- Dropped dead `node-fetch` + `@types/node-fetch` (only the removed Jest setup
  used them; source uses global `fetch`).
- `wiki/Developer-Guide.md`: the referenced test scripts now exist; corrected the
  "all tests" wording and added the terms-acceptance provisioning step.
- Port drift: the test harness now consistently uses `3333` (the compose host
  port); the code default stays Planka's conventional `3000` fallback.

## Automated reviewer findings

### Security review (cadence-forge:security-reviewer, Opus)

**S-C1 — Tracked `.env` with `SECRET_KEY` + passwords (CRITICAL).** `.env` is
committed (added in `4aead19`), `.gitignore` has no `.env` entry, and there is no
`.env.example`. Verified independently: `git ls-files` lists `.env`; the commit is
on `main`, `planka-v2.1-compat`, and the pushed `fork/planka-v2.1-compat`
(`github.com/cameronsjo/kanban-mcp`) — present across 10 commits of history.
`SECRET_KEY` is Planka's JWT/session signing key; a known signing key allows
forged tokens against any instance using it. The reviewer (correctly) did not
exfiltrate the values; the prevent-secret-leaks guard blocks reading them, so
whether they are throwaway or live is unknown. **Needs the owner's decision**
(real vs throwaway?), then: `git rm --cached .env`, add to `.gitignore`, ship a
`.env.example`, rotate `SECRET_KEY` + all passwords (they are in history), and
decide whether to scrub history (risky — shared with PR #10). NOT actioned this
session.

**S-I2 — Hardcoded credentials in `package.json` `inspector:demo`** (= C2 above):
real-looking `@cursor.com` agent email/password + `PLANKA_ADMIN_ID`. Remove or
source from env; rotate if the account is real.

**S-I3 — Resource IDs interpolated into URL paths without validation/encoding
(Important).** Every `plankaRequest(\`/api/.../${id}\`)` takes `id` as `z.string()`
free text from the MCP client; none are validated or `encodeURIComponent`'d.
Verified NOT cross-origin SSRF (host is always pinned via `new URL(path, base)`,
so the Bearer token can't be exfiltrated). It IS a bounded **same-host path
traversal / cross-resource confusion**: `id="../../users"` →
`http://host/api/users`, `id="1?x=y"` → query injection — so a tool can be
coerced (e.g. via prompt injection in card text) into hitting a different
endpoint with the agent's privileges. Fix: validate IDs as numeric snowflakes
(`^\d+$`) in the Zod schemas, or `encodeURIComponent` each ID (reviewer verified
`%2F` does not traverse). Multi-site → follow-up.

**S-I4 — Auth token never invalidated on 401** (= C3 above): `agentToken` is
cached forever; on expiry/revocation every request 401s with no re-auth path
until process restart. Plus no in-flight dedup (concurrent first calls each mint
a token). Fix: clear `agentToken` + retry once on 401; cache the in-flight login
promise.

**S-N5 — Wiki references a non-existent `.env.example`** (`Developer-Guide.md`
"Copy the `.env.example`…") — resolved by the S-C1 fix.

**Confirmed safe (checked):** no token/password leakage in errors or logs
(`url` in the rethrow never carries the Bearer token; password is request-body
only) — one caveat: a `PLANKA_BASE_URL` with embedded userinfo would surface in
the error string (doc note). `buildUrl`/`URLSearchParams` encode query values
correctly. `integration.yml` is clean (throwaway creds only, no
`github.event.*` interpolation → no workflow injection). The provisioning
scripts take creds as positional args, use `command curl`, and trap-clean the
mktemp cookie jar. `credentials: "include"` is a harmless no-op under Node fetch.

### Code review (cadence:code-reviewer, Sonnet)

**R-C1 — `getTasks`/`getTask` read v1 `included.tasks` while `ensureTaskListId`
uses v2.1 `included.taskLists` (Important; reviewer rated Critical).** Verified:
`operations/tasks.ts:277,318` read `response.included.tasks`; `ensureTaskListId`
(:119) reads `included.taskLists`. It currently works because Planka 2.1.1
returns BOTH (the flat rollup + task lists) — the live suite passed. But if a
future Planka drops the rollup, `getTasks` silently returns `[]` and `getTask`
throws. No unit test exercises a populated `getTasks`/`getTask`, so CI wouldn't
catch it. Follow-up (currently-working, so not fixed this pass).

**R-C2 / R-I1 — Dead, wrong-shape schemas in `common/types.ts` (cleanup
follow-up).** Verified `PlankaBoardMembershipSchema` (:111) and
`PlankaCommentSchema` (:84) are imported nowhere. Their shapes contradict the
live operation schemas: membership `role: enum["editor","admin"]` +
`updatedAt` non-nullable (live: `role: string`, nullable); comment
`cardId`/`userId` required (live: optional). A future consumer importing from
`common/types.ts` would hit Zod parse failures on valid 2.x data. Delete or
align + wire in.

**R-I2 — Unvalidated `unknown[]` returns** (`getBoardMemberships`
boardMemberships.ts:161; `getLabels` labels.ts:215; `getComments` fallback
comments.ts:139): returned without a Zod parse, so callers get untyped data.
Overlaps C1 above (error-swallowing family).

**R-I3 — `batchCreateTasks` fires N redundant `GET /api/cards/:id`** (one per
task via `ensureTaskListId`, tasks.ts:213-241) for N tasks on the same card.
Memoize the task-list id per `cardId` → 1 GET + N POSTs.

**R-I4 — `agentToken` no 401 re-auth** — same as S-I4 / C3.

**R-N1 — `updateTask`/`deleteTask` routes (tasks.ts:357,372) lack unit
coverage** — only exercised live. Two small `request-shapes.test.ts` assertions
would lock them in CI. (Good first follow-up.)

**R-N2 — `batchCreateTasks` mutates caller objects + `if (!task.position)`
overrides a legitimate `position: 0`** (tasks.ts:217-219). Use
`task.position ?? 65535 * (i + 1)` and don't write back.

**R-N3 — `getComment`'s O(boards×cards) fan-out** is documented at the function
(comments.ts:155) but not at the MCP tool registration in `index.ts` — an agent
calling `get_comment` has no signal it may fire dozens of requests.

**R-N4 — Biome scope is test/config only** — production source (the `any`-heavy
`tasks.ts`, `tools/board-summary.ts`) is unchecked. Intentional this pass; the
commit message + this doc record it. Expand during the full-repo reformat.

**Good patterns the reviewer called out:** the `helpers.ts` fetch-spy harness
(auth auto-stub + `businessCalls`/`onlyBusinessCall` filtering), route
assertions pitched at method+pathname+body (not Zod internals), `ensureTaskListId`
isolating the v2 task-list invariant, `passthrough()` on `CommentSchema`, the
401-probe integration precheck, and the CI/integration split.

## Recommended follow-up issues (priority order)
1. **CRITICAL — untrack & rotate `.env`** (S-C1): `git rm --cached .env`, gitignore
   it, add `.env.example`, rotate `SECRET_KEY` + all passwords (in history),
   decide on history scrub. **Owner decision required** (real vs throwaway values).
2. **Validate/encode resource IDs** in URL paths (S-I3) — `^\d+$` in the Zod
   schemas or `encodeURIComponent`; closes the same-host path-traversal vector.
3. **Handle the 2.1.x terms-acceptance gate** in `authenticateAgent` (F1).
4. **Invalidate `agentToken` on 401** + dedupe in-flight login (S-I4 / R-I4 / C3).
5. **Stop swallowing errors / returning unvalidated `[]`** in get* ops (C1 / R-I2).
6. **Fix `getTasks`/`getTask` to use the v2.1 task-list shape** (R-C1) before
   Planka drops the v1 flat rollup; add a populated-response unit test.
7. **Delete/align the dead `common/types.ts` schemas** (R-C2 / R-I1).
8. **Memoize `ensureTaskListId` per card in `batchCreateTasks`** (R-I3); fix the
   `position: 0` override + caller-object mutation (R-N2).
9. **Add unit coverage for `updateTask`/`deleteTask` routes** (R-N1).
10. Move `inspector:demo` credentials out of `package.json` (S-I2 / C2).
11. Deliberate full-repo Biome reformat + expand lint scope to source (R-N4).
12. Bound/replace the module-level `taskCardIdMap` (C3).
