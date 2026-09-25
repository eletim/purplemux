# `~/.purplemux/` Settings Directory

All persistent state (settings, layouts, session history, caches) lives under `~/.purplemux/`. See [CLAUDE.md §15](../CLAUDE.md) — memory/variables and `localStorage` are not used.

File permissions are `0600` for anything containing a secret (config, tokens, layouts, VAPID keys, lock file). Store-managed JSON writes generally use a `tmpFile → rename` pattern plus a `withLock` promise queue (in-process) to avoid interleaving. The external-terminal marker key is the exception described below.

---

## Directory Layout

```
~/.purplemux/
├── config.json              # app config (auth, theme, locale, …)
├── workspaces.json          # workspace list + sidebar state
├── ext-reviews.json         # external review definitions
├── external-servers.json    # external server registrations + creation history
├── external-terminal-marker-key # external-terminal marker authentication secret
├── workspaces/
│   └── {wsId}/
│       ├── layout.json           # pane/tab tree
│       ├── message-history.json  # per-workspace input history
│       └── claude-prompt.md      # --append-system-prompt-file content
├── hooks.json               # Claude Code hook + statusline config (generated)
├── status-hook.sh           # hook → POST /api/status/hook (generated, 0755)
├── statusline.sh            # statusline → POST /api/status/statusline (generated, 0755)
├── rate-limits.json         # latest statusline JSON written by statusline.sh
├── session-history.json     # completed Claude session log (cross-workspace)
├── quick-prompts.json       # custom quick prompts + disabled builtins
├── sidebar-items.json       # custom sidebar items + disabled builtins
├── vapid-keys.json          # Web Push VAPID keypair (generated)
├── push-subscriptions.json  # Web Push endpoint subscriptions
├── cli-token                # CLI auth token (generated)
├── port                     # current server port (hook scripts read it)
├── pmux.lock                # single-instance lock {pid, port, startedAt}
├── logs/                    # pino-roll log files
│   └── purplemux.YYYY-MM-DD.N.log
├── uploads/                 # images attached via web input bar
│   └── {wsId}/{tabId}/{ts}-{rand}-{name}.{ext}
└── stats/                   # Claude usage statistics
    ├── cache.json
    ├── uptime-cache.json
    └── daily-reports/
        └── YYYY-MM-DD.json
```

---

## Top-level Files

### `config.json` — `src/lib/config-store.ts`

App-wide settings. `authPassword` is scrypt-hashed (`scrypt:{salt}:{hash}`); deleting the file resets onboarding.

| Key | Meaning |
| --- | --- |
| `authPassword` | scrypt hash of the login password |
| `authSecret` | HMAC secret for session tokens (32 bytes hex) |
| `appTheme` | `light` / `dark` |
| `terminalTheme` | `{ light, dark }` xterm.js theme names |
| `customCSS` | User-injected CSS string |
| `locale` | `en` / `ko` / `ja` / … |
| `fontSize` | `small` / `normal` / `large` |
| `notificationsEnabled` | System/web-push notification toggle |
| `dangerouslySkipPermissions` | Pass `--dangerously-skip-permissions` to Claude |
| `editorUrl` / `editorPreset` | External editor (e.g. code-server, VS Code) |
| `networkAccess` | `localhost` / `network` — server bind scope |
| `systemResourcesEnabled` | CPU/memory stats display toggle |
| `updatedAt` | ISO timestamp |

Electron additionally stores `server` (`local`/`remote` mode + `remoteUrl`) and `windowState` (position, size, fullscreen) in this file — see `electron/main.ts`.

### `workspaces.json` — `src/lib/workspace-store.ts`

Workspace index and sidebar state. Per-workspace tab/pane tree lives under `workspaces/{wsId}/layout.json`.

```jsonc
{
  "workspaces": [
    { "id": "ws-MMKl07", "name": "purplemux", "directories": ["/path"], "order": 0 }
  ],
  "activeWorkspaceId": "ws-MMKl07",
  "sidebarCollapsed": false,
  "sidebarWidth": 285,
  "updatedAt": "2026-04-18T15:31:48.741Z"
}
```

Legacy migrations: `tabs.json` → `layout.json` → `workspaces/{wsId}/layout.json`. Parse failures copy the file to `.json.bak` and start fresh.

### `ext-reviews.json`, `external-servers.json`, `external-terminal-marker-key`

- `ext-reviews.json` stores fixed external-review definitions. Deleting it removes the definitions only; it never changes the external tmux server, sessions, windows, or panes.
- `external-servers.json` stores external-server registrations and terminal-creation idempotency/audit history. Deleting it unregisters every server without stopping external tmux resources.
- `external-terminal-marker-key` is the generated 32-byte secret that authenticates ownership markers on created external sessions. It is created directly with exclusive `O_EXCL` semantics (`flag: 'wx'`) and a read-after-race fallback, not `tmpFile → rename` or `withLock`, then cached for the process lifetime. Deleting it while PurpleMux is running does not change the cached key; after restart, a different key is generated when next needed and previously marked sessions are treated as unowned.

A full-directory backup includes all three files. Restore `external-servers.json` and `external-terminal-marker-key` together to preserve external-terminal ownership; restored external reviews and registrations remain usable only if their frozen socket and tmux identities still match.

### `hooks.json` — `src/lib/hook-settings.ts`

Claude Code `--settings` file. Regenerated on server startup from `buildHookSettings()`; overwrites are skipped when content matches.

Hooks mapped to `status-hook.sh`:

| Event | Arg |
| --- | --- |
| `SessionStart` | `session-start` |
| `UserPromptSubmit` | `prompt-submit` |
| `Notification` | `notification` |
| `Stop` / `StopFailure` | `stop` |
| `PreCompact` | `pre-compact` |
| `PostCompact` | `post-compact` |

Plus `statusLine.command = sh "~/.purplemux/statusline.sh"`.

See [STATUS.md](./STATUS.md) for the full status-detection flow.

### `status-hook.sh`, `statusline.sh`

Auto-generated from `HOOK_SCRIPT_CONTENT` (`hook-settings.ts`) and `STATUSLINE_SCRIPT_CONTENT` (`statusline-script.ts`). Both:

1. Read `port` and `cli-token` from `~/.purplemux/`
2. `POST` to the local server with `x-pmux-token` header
3. Fail silently if the server is down

Do not edit these by hand — they are rewritten on startup when content differs.

### `rate-limits.json`

Claude CLI writes its statusline JSON via stdin → `statusline.sh` → `POST /api/status/statusline` → server persists here. Watched by `rate-limits-watcher.ts` (debounced 500 ms); updates drive the rate-limit UI. Schema: `ts`, `model`, `five_hour`, `seven_day`, `context`, `cost`.

### `session-history.json` — `src/lib/session-history.ts`

Cross-workspace log of completed Claude sessions (max 200 entries, version 1). Keyed by `IHistoryEntry` (prompt, result, duration, tool usage, touched files).

### `quick-prompts.json`, `sidebar-items.json` — `src/lib/{quick-prompts,sidebar-items}-store.ts`

User customizations layered on top of built-in lists. Structure:

```json
{ "custom": [...], "disabledBuiltinIds": [...], "order": [...] }
```

Built-ins (`BUILTIN_PROMPTS`, `BUILTIN_ITEMS`) are defined in code; the disk file only records overrides and ordering.

### `vapid-keys.json`, `push-subscriptions.json`

Web Push state. VAPID keypair is generated on first run (`vapid-keys.ts`) and cached in memory. Subscriptions are managed per-browser via `push-subscriptions.ts`.

### `cli-token`, `port`

Shared handshake between the server and any CLI/hook that needs to reach it:

- `cli-token` — 32-byte hex token (`randomBytes(32)`), compared with `timingSafeEqual` in `cli-token.ts`. Read by `bin/cli.js` and all hook scripts via the `x-pmux-token` header.
- `port` — plain-text current port, written by `ensureHookSettings(port)` at startup.

### `pmux.lock` — `src/lib/lock.ts`

Single-instance guard. Contains `{pid, port, startedAt}`. On startup:

1. Attempt `open(LOCK_FILE, 'wx')` — if successful, we own it.
2. If it exists, read the PID. Dead PID → reclaim. Alive but `GET /api/health` does not reply `{ app: 'purplemux' }` → reclaim.
3. Alive + healthy → abort with "already running".

Released on `process.on('exit')`.

---

## Per-workspace Directory (`workspaces/{wsId}/`)

### `layout.json` — `src/lib/layout-store.ts`

Recursive pane/tab tree. Leaf `pane` nodes hold `tabs[]`; `split` nodes hold `children[]` with `ratio`. Each tab carries its `sessionName` (`pt-{wsId}-{paneId}-{tabId}`), cached `cliState`, `claudeSessionId`, and the last resume command.

See [TMUX.md](./TMUX.md) for how tabs map to tmux sessions and [STATUS.md](./STATUS.md) for the state fields.

### `message-history.json` — `src/lib/message-history-store.ts`

Per-workspace input history for Claude tabs. Capped at 500 entries. Locks are keyed by `wsId` so parallel workspace writes do not block each other.

### `claude-prompt.md` — `src/lib/claude-prompt.ts`

The `--append-system-prompt-file` content passed to every Claude tab in the workspace. Regenerated whenever the workspace is created, renamed, or its directories change. Contains workspace ID + CLI quick-reference.

---

## `logs/`

Pino-roll output. One file per UTC day with numeric suffix when size is exceeded:

```
purplemux.2026-04-19.1.log
```

Root level defaults to `info`; override with `LOG_LEVEL=debug` or per-group with `LOG_LEVELS=hooks=debug,status=warn,tmux=trace`. See `src/lib/logger.ts`.

---

## `uploads/` — `src/lib/uploads-store.ts`

Images attached via the chat input bar (drag/drop, paste, paperclip). Saved as `{timestamp}-{rand}-{name}.{ext}` under `{wsId}/{tabId}/` so paths can be passed to the running Claude CLI.

- Allowed MIME types: `image/png`, `image/jpeg`, `image/gif`, `image/webp`
- Max size: 10 MB
- Files are written with `0600` permissions
- Auto-cleanup on server start removes anything older than 24 hours
- Manual cleanup: Settings → System → Attached Images → Clean now (or `POST /api/uploads/cleanup` with `{ "mode": "all" | "expired" }`)

---

## `stats/`

Claude usage statistics cache. Derived from `~/.claude/projects/**/*.jsonl` — purplemux only reads that directory.

| File | Contents |
| --- | --- |
| `cache.json` | `IStatsFileCache` — per-day aggregates (messages, sessions, tool calls, hourly counts, per-model token usage). Cache version `1`. |
| `uptime-cache.json` | Per-day uptime/active-minutes roll-up. |
| `daily-reports/{date}.json` | AI-generated daily brief (`IDailyReportDay`) keyed by `YYYY-MM-DD`. |

All files here are regeneratable — deleting them just triggers a recompute on the next stats request.

---

## Deleting to Reset

| To reset… | Delete |
| --- | --- |
| Login password (onboarding again) | `config.json` |
| All workspaces and tabs | `workspaces.json` + `workspaces/` |
| A single workspace's layout | `workspaces/{wsId}/layout.json` (it will be recreated as a default pane) |
| Usage statistics | `stats/` |
| Push subscriptions | `push-subscriptions.json` |
| External review definitions | `ext-reviews.json` (external tmux resources are untouched) |
| External server registrations | `external-servers.json` (external tmux resources are untouched) |
| Stuck "already running" | `pmux.lock` (only if no purplemux process is alive) |

`hooks.json`, `status-hook.sh`, `statusline.sh`, `port`, `cli-token`, `vapid-keys.json` are auto-regenerated on the next startup.
