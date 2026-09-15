# External review definitions

External review definitions are stored in `~/.purplemux/ext-reviews.json`, independently of Workspaces and tabs. They do not adopt or own external tmux resources.

The CLI-token-authenticated API supports:

- `POST /api/cli/ext-reviews` with `{ "socketPath": "/absolute/known/tmux/socket", "session": "exact-session-name", "windowTargets": ["@1", "@3"] }`.
- `GET /api/cli/ext-reviews` to list persisted definitions, including unavailable ones.
- `GET /api/cli/ext-reviews/:reviewId` to validate and resolve the frozen allowlist. Unavailable or changed identities return 409.
- `DELETE /api/cli/ext-reviews/:reviewId` to remove only the definition, even if its resources are unavailable.

Creation requires a known socket path (not a socket name, symlink, or the purplemux-owned `purple` socket), an exact session name or `$sessionId`, and a nonempty list of unique `@windowId` targets. No socket, session, or window discovery is performed. Validation does not start a tmux server. Socket filesystem identity, server PID, session ID and creation time, and window IDs are persisted. Lookup uses those identities rather than mutable names or window indices; added windows never enter the allowlist. Renaming a session preserves the definition; replacing its socket, server, session, or a selected window makes it unavailable. Recreating a definition is explicit.

Deletion does not send any tmux command. Definitions and their external resources never enter Workspace cleanup.
