# External review definitions

External review definitions are stored in `~/.purplemux/ext-reviews.json`, independently of Workspaces and tabs. They do not adopt or own external tmux resources.

The API accepts either the CLI token (`x-pmux-token`) or an authenticated browser session cookie and supports:

- `POST /api/cli/ext-reviews` with `{ "socketPath": "/absolute/known/tmux/socket", "session": "exact-session-name", "windowTargets": ["@1", "@3"] }`.
- `GET /api/cli/ext-reviews` to list persisted definitions, including unavailable ones.
- `GET /api/cli/ext-reviews/:reviewId` to validate and resolve the frozen allowlist. Unavailable or changed identities return 409.
- `DELETE /api/cli/ext-reviews/:reviewId` to remove only the definition, even if its resources are unavailable.

Creation returns HTTP 201 with the persisted definition, including its machine-readable `id`, and a `url` of `/ext-review/:id`. There is no target-update endpoint; changing targets requires explicitly creating a new definition.

Creation requires a known socket path (not a socket name, symlink, or the purplemux-owned `purple` socket), an exact session name or `$sessionId`, and a nonempty list of unique `@windowId` targets. No socket, session, or window discovery is performed. Validation does not start a tmux server. Socket filesystem identity, server PID, session ID and creation time, and window IDs are persisted. Lookup uses those identities rather than mutable names or window indices; added windows never enter the allowlist. Renaming a session preserves the definition; replacing its socket, server, session, or a selected window makes it unavailable. Recreating a definition is explicit.

Deletion does not send any tmux command. Definitions and their external resources never enter Workspace cleanup.

## Live observation transport

An authenticated browser can open `WS /api/ext-review-terminal?reviewId=:id&windowId=%40N` to observe one window from the Review's frozen allowlist. Both parameters are required; unknown, duplicate, socket/session/pane overrides, and dimension parameters are rejected with close code 1008. Select another approved window by opening a separate observation connection. This transport does not use managed Workspace terminals.

The connection sends the existing binary `MSG_STDOUT` frames containing ANSI screen snapshots, suitable for the existing xterm rendering infrastructure. All panes in the approved window are captured at their external positions and dimensions. Screens are polled every 250 ms and sent when changed; this is current-screen observation, not a lossless output/history stream. The viewer should have enough local rows and columns to display the external window; resizing the viewer never resizes tmux.

Only a single-byte binary `MSG_HEARTBEAT` is accepted and echoed. Send one at least every 30 seconds. Every other message is rejected with 1008, including stdin, web input, send-keys, kill, rename, resize, target changes, text commands, and unknown opcodes. The server never attaches a client or changes terminal state: it uses scoped `list-panes` and `capture-pane -p` reads, with `-N` to prevent server creation. Added windows are never observed. Missing or replaced frozen targets close the observation with 1011; they are not recreated or substituted.

Disconnect, Review deletion, heartbeat expiry, and server shutdown release only local timers, sockets, and in-flight read command processes. Deletion in a separate Next server process is detected on the next poll. Backpressure skips captures while continuing to check the frozen definition and targets. There are at most 32 observation connections.
