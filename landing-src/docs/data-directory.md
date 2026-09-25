---
title: Data directory
description: What lives under ~/.purplemux/, what's safe to delete, and how to back it up.
eyebrow: Reference
permalink: /docs/data-directory/index.html
---
{% from "docs/callouts.njk" import callout %}

Every persistent piece of state purplemux keeps — settings, layouts, session history, caches — lives under `~/.purplemux/`. Nothing else. No `localStorage`, no system keychain, no external service.

## Layout at a glance

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
│       ├── message-history.json  # input history per workspace
│       └── claude-prompt.md      # --append-system-prompt-file content
├── hooks.json               # Claude Code hook + statusline config (generated)
├── status-hook.sh           # hook script (generated, 0755)
├── statusline.sh            # statusline script (generated, 0755)
├── rate-limits.json         # latest statusline JSON
├── session-history.json     # completed Claude session log (cross-workspace)
├── quick-prompts.json       # custom quick prompts + disabled built-ins
├── sidebar-items.json       # custom sidebar items + disabled built-ins
├── vapid-keys.json          # Web Push VAPID keypair (generated)
├── push-subscriptions.json  # Web Push endpoint subscriptions
├── cli-token                # CLI auth token (generated)
├── port                     # current server port
├── pmux.lock                # single-instance lock {pid, port, startedAt}
├── logs/                    # pino-roll log files
├── uploads/                 # images attached via the chat input bar
└── stats/                   # Claude usage statistics cache
```

Files containing secrets (config, tokens, layouts, VAPID keys, lock) are written with mode `0600` via a `tmpFile → rename` pattern.

## Top-level files

| File | What it stores | Safe to delete? |
|---|---|---|
| `config.json` | scrypt-hashed login password, HMAC session secret, theme, locale, font size, notification toggle, editor URL, network access, custom CSS | Yes — re-runs onboarding |
| `workspaces.json` | Workspace index, sidebar width / collapsed state, active workspace ID | Yes — wipes all workspaces and tabs |
| `ext-reviews.json` | Fixed external-review definitions | Yes — removes only the definitions; external tmux resources are untouched |
| `external-servers.json` | External-server registrations and terminal-creation idempotency/audit history | Yes — unregisters every server; external tmux resources are untouched |
| `external-terminal-marker-key` | Generated secret that authenticates ownership markers on created external sessions | Not without accepting that existing marked sessions will become unowned; a different key is generated when next needed |
| `hooks.json` | Claude Code `--settings` mapping (event → script) + `statusLine.command` | Yes — regenerated on next start |
| `status-hook.sh`, `statusline.sh` | POST to `/api/status/hook` and `/api/status/statusline` with `x-pmux-token` | Yes — regenerated on next start |
| `rate-limits.json` | Latest Claude statusline JSON: `ts`, `model`, `five_hour`, `seven_day`, `context`, `cost` | Yes — repopulates as Claude runs |
| `session-history.json` | Last 200 completed Claude sessions (prompts, results, durations, tools, files) | Yes — clears history |
| `quick-prompts.json`, `sidebar-items.json` | `{ custom: […], disabledBuiltinIds: […], order: […] }` overlays on the built-in lists | Yes — restores defaults |
| `vapid-keys.json` | Web Push VAPID keypair, generated on first run | Don't unless you also delete `push-subscriptions.json` (existing subscriptions break) |
| `push-subscriptions.json` | Per-browser push endpoints | Yes — re-subscribe on each device |
| `cli-token` | 32-byte hex token for `purplemux` CLI and hook scripts (`x-pmux-token` header) | Yes — regenerated on next start, but any hook script that's already been generated keeps the old token until the server overwrites it |
| `port` | Plain-text current port, read by hook scripts and the CLI | Yes — regenerated on next start |
| `pmux.lock` | Single-instance guard `{ pid, port, startedAt }` | Only if no purplemux process is alive |

{% call callout('warning', 'Lock file gotchas') %}
If purplemux refuses to start with "already running" but no process is alive, `pmux.lock` is stale. `rm ~/.purplemux/pmux.lock` and try again. If you ever ran purplemux with `sudo`, the lock file may be owned by root — `sudo rm` it once.
{% endcall %}

## Per-workspace directory (`workspaces/{wsId}/`)

Every workspace gets its own folder, named after the generated workspace ID.

| File | Contents |
|---|---|
| `layout.json` | Recursive pane/tab tree: leaf `pane` nodes with `tabs[]`, `split` nodes with `children[]` and a `ratio`. Each tab carries its tmux session name (`pt-{wsId}-{paneId}-{tabId}`), cached `cliState`, `claudeSessionId`, last resume command. |
| `message-history.json` | Per-workspace Claude input history. Capped at 500 entries. |
| `claude-prompt.md` | The `--append-system-prompt-file` content passed to every Claude tab in this workspace. Regenerated on workspace create / rename / directory change. |

Delete a single `workspaces/{wsId}/layout.json` to reset that workspace's layout to a default pane without touching the others.

## `logs/`

Pino-roll output, one file per UTC day, with a numeric suffix when size limits are exceeded:

```
logs/purplemux.2026-04-19.1.log
```

Default level is `info`. Override with `LOG_LEVEL` or per-module with `LOG_LEVELS` — see [Ports & env vars](/purplemux/docs/ports-env-vars/).

Logs rotate weekly (7-file limit). Safe to delete at any time.

## `uploads/`

Images attached via the chat input bar (drag, paste, paperclip):

```
uploads/{wsId}/{tabId}/{timestamp}-{rand}-{name}.{ext}
```

- Allowed: `image/png`, `image/jpeg`, `image/gif`, `image/webp`
- Max 10 MB per file, mode `0600`
- Auto-cleaned on server start: anything older than 24 hours is removed
- Manual cleanup at **Settings → System → Attached Images → Clean now**

## `stats/`

Pure cache. Derived from `~/.claude/projects/**/*.jsonl` — purplemux only reads that directory.

| File | Contents |
|---|---|
| `cache.json` | Per-day aggregates: messages, sessions, tool calls, hourly counts, per-model token usage |
| `uptime-cache.json` | Per-day uptime / active-minutes roll-up |
| `daily-reports/{YYYY-MM-DD}.json` | AI-generated daily brief |

Delete the whole folder to force a recompute on the next stats request.

## Reset matrix

| To reset… | Delete |
|---|---|
| Login password (re-onboard) | `config.json` |
| All workspaces and tabs | `workspaces.json` + `workspaces/` |
| One workspace's layout | `workspaces/{wsId}/layout.json` |
| Usage statistics | `stats/` |
| Push subscriptions | `push-subscriptions.json` |
| External review definitions | `ext-reviews.json` (external tmux resources are untouched) |
| External server registrations | `external-servers.json` (external tmux resources are untouched) |
| Stuck "already running" | `pmux.lock` (only if no process alive) |
| Everything (factory reset) | `~/.purplemux/` |

`hooks.json`, `status-hook.sh`, `statusline.sh`, `port`, `cli-token`, and `vapid-keys.json` are all auto-regenerated on next startup, so deleting them is harmless.

## Backups

The whole directory is plain JSON plus a few shell scripts. To back up:

```bash
tar czf purplemux-backup.tgz -C ~ .purplemux
```

To restore on a fresh machine, untar and start purplemux. Hook scripts will be rewritten with the new server's port; everything else (workspaces, history, settings) lifts over as-is. Keep `external-servers.json` and `external-terminal-marker-key` together to preserve external-terminal ownership. Restored external reviews and registrations are usable only when their frozen socket and tmux identities still match.

{% call callout('warning') %}
Don't restore `pmux.lock` — it's tied to a specific PID and will block startup. Exclude it: `--exclude pmux.lock`.
{% endcall %}

## Wipe everything

```bash
rm -rf ~/.purplemux
```

Make sure no purplemux is running first. Next launch will be the first-run experience again.

## What's next

- **[Ports & env vars](/purplemux/docs/ports-env-vars/)** — every variable that influences this directory.
- **[Architecture](/purplemux/docs/architecture/)** — how the files connect to the running server.
- **[Troubleshooting](/purplemux/docs/troubleshooting/)** — common issues and fixes.
