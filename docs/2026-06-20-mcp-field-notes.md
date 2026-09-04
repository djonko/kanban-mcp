# kanban-mcp field notes — 2026-06-20

Anomalies hit while exercising the write path against Planka 2.1.1
(`https://planka.tail89e340.ts.net`, board `Tasks` / list `Backlog`).
Feeds PR #10 / branch `planka-v2.1-compat`.

---

## 1. `card_manager create` fails — `type` missing in the *running* server

**Action:** `mcp__kanban__mcp_kanban_card_manager` `action: "create"`

**Params sent:**
```json
{
  "action": "create",
  "listId": "1801643218647909391",
  "name": "[feedly-clip-to-obsidian] Push And Verify E2e",
  "description": "Push local commits to Gitea and verify…\n\nStatus: …\nIntro: …\nDated: 2026-06-19"
}
```

**Raw error:**
```
Failed to create card: Failed to make Planka request to
https://planka.tail89e340.ts.net/api/lists/1801643218647909391/cards:
The server could not fulfill this request (`POST /api/lists/1801643218647909391/cards`)
due to 1 missing or invalid parameter.
```

**Endpoint implicated:** `POST /api/lists/:listId/cards`
**Operation:** `operations/cards.ts` → `createCard()`

### Root cause: stale running process, NOT a missing fix

The fix already exists in source **and** in the built dist:

- `operations/cards.ts:153` → `type: options.type ?? "project"` (source, mtime 17:00)
- `dist/operations/cards.js:123` → `type: options.type ?? "project"` (built, **mtime 17:00:06**)

But every live MCP server process was started *before* that build:

```
$ ps -eo pid,lstart,command | grep kanban-mcp/dist/index.js
 5571  Jun 20 15:58:09  node …/kanban-mcp/dist/index.js
10388  Jun 20 16:00:25  …
23645  Jun 20 16:06:27  …
35823  Jun 20 16:08:53  …
53632  Jun 20 16:13:34  …
 2182  Jun 20 16:30:48  …
37672  Jun 20 16:38:20  …
 4317  Jun 20 16:54:26  …
 5748  Jun 20 16:54:43  …
```

All 9 PIDs start ≤ 16:54; the card-create fix landed in dist at 17:00:06.
Node loads `dist` once at startup and does not hot-reload, so each running
server is executing pre-fix bytecode that omits the `type` field — Planka 2.1.1
then rejects the create as a missing required parameter.

**Implication:** the write path is busted *only for the already-running process*.
No code change is needed — respawning the MCP server (Claude Code restart or MCP
reconnect) picks up the 17:00 dist and card-create works.

### Confirmation that the payload shape is otherwise correct

Planka 2.1.1 `POST /api/lists/:id/cards` requires `type ∈ {project, story}`
(generalizes the documented "every create requires a `type`/`role` field" gotcha).
`position` defaults to 65535 in the patched code. With `type: "project"` supplied,
the create succeeds.

### Caveat noted during investigation

9 concurrent `kanban-mcp` node processes were live and the repo source churned
between 16:53–17:00 — consistent with another session actively patching this exact
bug. This file is the only artifact written to the repo by the card-population
session; no source or git state was touched.

---

## Fallback taken

Per the populate-board plan: MCP write probed **once**, failed as above, logged here,
and card creation switched off the MCP onto the Planka REST API directly (same
`POST /api/lists/:id/cards` endpoint, with `type: "project"` supplied explicitly).
