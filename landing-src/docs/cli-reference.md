---
title: CLI reference
description: Every subcommand and flag of the purplemux and pmux binaries.
eyebrow: Reference
permalink: /docs/cli-reference/index.html
---
{% from "docs/callouts.njk" import callout %}

`purplemux` ships with two ways to use the binary: as a server starter (`purplemux` / `purplemux start`) and as an HTTP API wrapper (`purplemux <subcommand>`) that talks to a running server. The short alias `pmux` is identical.

## Two roles, one binary

| Form | What it does |
|---|---|
| `purplemux` | Start the server. Same as `purplemux start`. |
| `purplemux <subcommand>` | Talk to a running server's CLI HTTP API. |
| `pmux ...` | Alias for `purplemux ...`. |

The dispatcher in `bin/purplemux.js` peels off the first argument: known subcommands route to `bin/cli.js`, anything else (or no argument) launches the server.

## Starting the server

```bash
purplemux              # default
purplemux start        # same thing, explicit
PORT=9000 purplemux    # custom port
HOST=all purplemux     # bind everywhere
```

See [Ports & env vars](/purplemux/docs/ports-env-vars/) for the full env surface.

The server prints its bound URLs, mode, and auth status:

```
  ⚡ purplemux  v0.x.x
  ➜  Available on:
       http://127.0.0.1:8022
       http://192.168.1.42:8022
  ➜  Mode:   production
  ➜  Auth:   configured
```

If `8022` is already in use the server warns and binds to a random free port instead.

## Subcommands

All subcommands require a running server. They read the port from `~/.purplemux/port` and the auth token from `~/.purplemux/cli-token`, both written automatically at server startup.

| Command | Purpose |
|---|---|
| `purplemux workspaces` | List workspaces |
| `purplemux workspace create --cwd PATH [--name NAME]` | Create a workspace |
| `purplemux workspace delete -w WS --if-empty` | Conditionally delete an empty workspace |
| `purplemux external-server register --socket PATH --name NAME` | Register an external tmux server |
| `purplemux external-server list` | List external server registrations |
| `purplemux external-server create-terminal ID [--name NAME] [--request-id ID]` | Create or reconcile an owned session on a registered server |
| `purplemux external-server unregister ID` | Remove a registration without changing tmux resources |
| `purplemux tab list [-w WS]` | List tabs (optionally scoped to a workspace) |
| `purplemux tab create -w WS [-n NAME] [-t TYPE]` | Create a new tab |
| `purplemux tab send -w WS TAB_ID CONTENT...` | Send input to a tab |
| `purplemux tab status -w WS TAB_ID` | Inspect a tab's status |
| `purplemux tab result -w WS TAB_ID` | Capture the tab pane's current content |
| `purplemux tab close -w WS TAB_ID` | Close a tab |
| `purplemux tab browser ...` | Drive a `web-browser` tab (Electron only) |
| `purplemux ext-review create --socket PATH --session SESSION --window @ID [--window @ID ...]` | Create an explicit external review |
| `purplemux ext-review get ID` | Validate and read a review definition |
| `purplemux ext-review delete ID` | Delete only a review definition |
| `purplemux api-guide` | Print the full HTTP API reference |
| `purplemux help` | Show usage |

Output is JSON unless noted. `--workspace` and `-w` are interchangeable.

### Safe workspace deletion

`purplemux workspace delete -w WS --if-empty` asks the server to check and delete the workspace in one atomic operation. It never closes tabs or kills sessions: close those first. The JSON `status` is `deleted` for a new deletion, `absent` when the desired final state already held, or `not-empty` when the workspace was left unchanged. `not-empty` exits with status 2.

If a transport failure or server error makes the mutation outcome uncertain, reconcile with `purplemux workspaces`. Direct HTTP clients can use `GET /api/cli/workspaces/<workspaceId>` for an exact `present` or `absent` result. Do not inspect `~/.purplemux` files or tmux state as an external lifecycle contract.

### External tmux server registration

Use `external-server register` with a display name and known absolute tmux socket path. It returns a stable registration ID with the name, path, and frozen Unix socket identity. `external-server create-terminal ID` predictably creates a new session and persists provenance bound to its exact tmux identity; pre-existing sessions remain unowned. Creation request IDs are idempotent, and the CLI reports the ID to reuse when an outcome is unknown. Session provenance remains on tmux across unregister/re-register. Registration rejects the PurpleMux-owned `purple` socket. Operations against a registered server recheck that identity and fail closed if the socket disappears or the path is replaced. `external-server unregister ID` deletes only the registration, even if the server is unavailable; it never sends tmux commands or kills sessions, windows, or panes. External Reviews remain a separate fixed-window, read-only feature.

### External review (0.5.0)

Observe known external tmux windows in your browser without importing them into a Workspace. Supply an absolute socket path, an exact session name or quoted `$sessionId`, and each explicit `@windowId`:

```bash
purplemux ext-review create --socket /absolute/known/tmux/socket --session '$2' --window @1 --window @3
purplemux ext-review get REVIEW_ID
purplemux ext-review delete REVIEW_ID
```

Replace these selectors with targets you already know. Socket symlinks and the PurpleMux-owned `purple` socket are rejected. Repeat `--window` for each unique target; there is no CLI `list`, discovery, or target-update command.

Creation prints one JSON document containing the persisted definition's `id` and an absolute browser `url`. Scripts can parse those fields directly. Open that URL in an authenticated browser to view the approved windows. `/ext-review` lists persisted definitions, including unavailable ones, and offers manual creation, Open, and Delete. Get prints the definition as JSON; delete prints `{"deleted":true}` on success.

The observation boundary is fixed and read-only. You see live current-screen snapshots, not lossless output history. Input, paste, send-keys, kill, rename, and external terminal resize are unavailable; resizing your browser changes only the local renderer. Socket/server/session/window identities are frozen at creation, so newly added windows never enter the allowlist. Missing or replaced targets become unavailable rather than being recreated or substituted. To change targets, explicitly create a new definition.

Reviews neither adopt nor own external resources. Their definitions and targets are excluded from Workspace ownership, discovery, and cleanup. Validation never starts a tmux server. Deleting a Review removes only its definition, even when targets are unavailable; it sends no tmux commands and leaves external sessions, windows, and panes running.

The lifecycle API accepts a CLI token or authenticated browser session cookie:

| Endpoint | Request / response |
|---|---|
| `POST /api/cli/ext-reviews` | Body: `{"socketPath":"/absolute/known/tmux/socket","session":"$2","windowTargets":["@1","@3"]}`. HTTP 201 returns the read-only definition with `id` and relative `url: "/ext-review/<id>"`. Invalid targets return 400. |
| `GET /api/cli/ext-reviews` | `{"reviews":[...]}` lists persisted definitions, including unavailable ones. |
| `GET /api/cli/ext-reviews/<reviewId>` | Returns the validated definition without `url`; missing definitions return 404, unavailable or changed targets return 409. |
| `DELETE /api/cli/ext-reviews/<reviewId>` | `{"deleted":true}` on success; missing definitions return 404. Definition-only deletion. |

The external server lifecycle API accepts the same CLI token or authenticated browser session cookie:

| Endpoint | Request / response |
|---|---|
| `POST /api/cli/external-servers` | Body: `{"socketPath":"/absolute/known/tmux/socket","name":"dev-server"}`. Returns the stored `id`, `name`, `socketPath`, and `socketIdentity`; invalid or unavailable sockets return 400. |
| `GET /api/cli/external-servers` | `{"servers":[...]}` lists persisted registrations without freezing sessions or windows. |
| `POST /api/cli/external-servers/<serverId>/terminals` | Body `{"requestId":"client-stable-id","name"?:"terminal-name"}`. Creates or reconciles one owned tmux session and returns its exact identities and provenance. |
| `DELETE /api/cli/external-servers/<serverId>` | `{"deleted":true}` on success; missing registrations return 404. Registration-only deletion. |

### `tab create` panel types

The `-t` / `--type` flag picks the panel type. Valid values:

| Value | Panel |
|---|---|
| `terminal` | Plain shell |
| `claude-code` | Shell with `claude` already running |
| `web-browser` | Embedded browser (Electron only) |
| `diff` | Git diff panel |

Without `-t`, you get a plain terminal.

### `tab browser` subcommands

These only work when the tab's panel type is `web-browser`, and only in the macOS Electron app — the bridge returns 503 otherwise.

| Subcommand | What it returns |
|---|---|
| `purplemux tab browser url -w WS TAB_ID` | Current URL + page title |
| `purplemux tab browser screenshot -w WS TAB_ID [-o FILE] [--full]` | PNG. With `-o` saves to disk; without, returns base64. `--full` captures the full page. |
| `purplemux tab browser console -w WS TAB_ID [--since MS] [--level LEVEL]` | Recent console entries (ring buffer, 500 entries) |
| `purplemux tab browser network -w WS TAB_ID [--since MS] [--method M] [--url SUBSTR] [--status CODE] [--request ID]` | Recent network entries; `--request ID` fetches one body |
| `purplemux tab browser eval -w WS TAB_ID EXPR` | Evaluate a JS expression and serialize the result |

## Examples

```bash
# Find your workspace
purplemux workspaces

# Create a Claude tab in workspace ws-MMKl07
purplemux tab create -w ws-MMKl07 -t claude-code -n "refactor auth"

# Send a prompt to it (TAB_ID comes from `tab list`)
purplemux tab send -w ws-MMKl07 tb-abc "Refactor src/lib/auth.ts to remove the cookie path"

# Watch its state
purplemux tab status -w ws-MMKl07 tb-abc

# Snapshot the pane
purplemux tab result -w ws-MMKl07 tb-abc

# Screenshot a web-browser tab full-page
purplemux tab browser screenshot -w ws-MMKl07 tb-xyz -o page.png --full
```

## Authentication

Every subcommand sends `x-pmux-token: $(cat ~/.purplemux/cli-token)` and is verified server-side via `timingSafeEqual`. The `~/.purplemux/cli-token` file is generated on first server start with `randomBytes(32)` and stored mode `0600`.

If you need to drive the CLI from another shell or a script that can't see `~/.purplemux/`, set the env vars instead:

| Variable | Default | Effect |
|---|---|---|
| `PMUX_PORT` | contents of `~/.purplemux/port` | Port the CLI talks to |
| `PMUX_TOKEN` | contents of `~/.purplemux/cli-token` | Bearer token sent as `x-pmux-token` |

```bash
PMUX_PORT=8022 PMUX_TOKEN=$(cat ~/.purplemux/cli-token) purplemux workspaces
```

{% call callout('warning') %}
The CLI token grants full server access. Treat it like a password. Don't paste it into chat, commit it, or expose it as a build env var. Rotate by deleting `~/.purplemux/cli-token` and restarting the server.
{% endcall %}

## update-notifier

`purplemux` checks npm for a newer version on every launch (via `update-notifier`) and prints a banner if one exists. Disable with `NO_UPDATE_NOTIFIER=1` or any of the [standard `update-notifier` opt-outs](https://github.com/yeoman/update-notifier#user-settings).

## Full HTTP API

`purplemux api-guide` prints the complete HTTP API reference for every `/api/cli/*` endpoint, including request bodies and response shapes — useful when you want to drive purplemux directly from `curl` or another runtime.

## What's next

- **[Ports & env vars](/purplemux/docs/ports-env-vars/)** — `PMUX_PORT` / `PMUX_TOKEN` in the broader env surface.
- **[Architecture](/purplemux/docs/architecture/)** — what the CLI is actually talking to.
- **[Troubleshooting](/purplemux/docs/troubleshooting/)** — when the CLI says "is the server running?".
